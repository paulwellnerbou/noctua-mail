const sqliteModulePromise = () => import("bun:sqlite" /* webpackIgnore: true */);
let DatabaseCtor: any | null = null;
import path from "path";
import { mkdirSync, promises as fs } from "fs";
import { simpleParser } from "mailparser";
import {
  getAttachmentsAccountDir,
  getDefaultAccountDbPath,
  getMainDbPath,
  getSourcesAccountDir
} from "./runtimePaths";
import type {
  Account,
  AccountSettings,
  Attachment,
  CalendarEvent,
  CalendarParticipationScope,
  CalendarParticipationStatus,
  CalendarEventSourceType,
  MessageCalendarInviteState,
  CalendarReminder,
  CaldavConfig,
  Folder,
  InviteCode,
  MailboxState,
  Message,
  Topic,
  TopicColor,
  User
} from "./data";
import { normalizeAccountSettings } from "./accountSettings";
import { decodeSecret, encodeSecret, shouldStorePasswordInDb } from "./secret";
import { applyCachedCredentials } from "./credentials";
import {
  CALENDAR_FILENAME_EXTENSIONS,
  CALENDAR_INVITE_FLAG,
  CALENDAR_MIME_HINTS,
  CRYPTO_SIGNATURE_FILENAME_EXTENSIONS,
  CRYPTO_SIGNATURE_MIME_HINTS,
  isCalendarAttachment,
  MIN_VISIBLE_ATTACHMENT_SIZE_BYTES,
  TODO_FLAG,
  DONE_FLAG,
  normalizeImapFlags
} from "./messageFlags";
import { withDbWriteRetry } from "./dbWriteRetry";
import { createHash, randomUUID } from "crypto";
import { buildMessageRowIdLookupCandidates } from "./messageIds";
import {
  buildMessageGroupKey,
  buildInviteDeckGroupKeyFromEvent,
  buildInviteDeckGroupKeyFromBounds,
  buildTimeGroupKey,
  buildWeekGroupKey,
  INVITE_DECK_GROUP_BY,
  sortGroupsForGroupBy
} from "./messageGrouping";
import {
  DEFAULT_THREAD_DATE_SOURCE,
  isThreadDateSensitiveGroupBy,
  normalizeThreadDateSource,
  type ThreadDateSource
} from "./threadDate";
import { resolveThreadingForItems } from "./threading";
import { normalizeReminderDateList, resolveNextReminderOccurrence } from "./reminderRecurrence";
import { resolveCalendarTimeZoneId } from "./calendarTimezones";
import { collectCalendarReminderMutationsFromCalendarInvite } from "./calendarReminderMutations";
import type { CalendarReminderMutation } from "./calendarReminderMutations";
import {
  collectCalendarInviteMutationGroups,
  type CalendarInviteActionType
} from "./calendarInviteProcessing";
import {
  extractEmailCalendarEventStatusFromIcs,
  normalizeCalendarEventStatus
} from "./calendarEventStatus";
import { deriveInviteDeckEventBounds } from "./inviteDeckEventBounds";
import { collectTopicSignalEntries, type TopicSignalSource } from "./topicSignals";
import {
  mergeCalendarParticipation,
  normalizeCalendarParticipationStatus,
  resolveCalendarParticipationFromPreview
} from "./calendarParticipation";
import {
  normalizeCalendarEventUid,
  normalizeCalendarEventUidKey,
  normalizeCalendarEventUidKeys,
  normalizeCalendarEventUids
} from "./calendarEventUids";
import { isSameMailboxMessageCopy } from "./messageCopies";
import { getAttachmentContentBuffer } from "./mail/syncMessageSanitizer";
import { deleteMessageFiles, getMessageSource } from "./storage";
import {
  CATEGORY_KEYS,
  createSeededLinearModel,
  extractLinearFeatures,
  trainLinearModelNegative,
  trainLinearModelPositive,
  type CategoryKey,
  type CategoryLinearModel
} from "./mail/categorization/linearModel";
import type { CategoryLearningDebugSnapshot } from "./mail/categorization/debugTypes";

let masterDbInstance: any | null = null;
let masterInitialized = false;
const accountDbInstances = new Map<string, any>();
const accountDbInitialized = new Set<string>();
const accountDbIdleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const calendarReminderSchemaSignatureByDb = new WeakMap<object, string>();
const messageCalendarEventSchemaSignatureByDb = new WeakMap<object, string>();
const threadSchemaSignatureByDb = new WeakMap<object, string>();
const calendarEventRuntimeSignatureByDb = new WeakMap<object, string>();
const ACCOUNT_DB_IDLE_MS = (() => {
  const raw = process.env.ACCOUNT_DB_IDLE_MS?.trim();
  if (!raw) return 5 * 60 * 1000; // 5 minutes: releases SQLite page cache sooner after syncs
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 5 * 60 * 1000;
  return parsed;
})();
let shutdownHooksRegistered = false;
const CALENDAR_REMINDER_SCHEMA_SIGNATURE = [
  "eventEndAtMs",
  "eventDescription",
  "eventUidKey"
].join("|");
const MESSAGE_CALENDAR_EVENT_SCHEMA_SIGNATURE = [
  "eventUidKey",
  "eventFirstStartAtMs",
  "eventLastEndAtMs",
  "inviteActionType",
  "processedAtMs",
  "processedByUserId"
].join("|");
const THREAD_SCHEMA_SIGNATURE = ["latestReceivedDateValue"].join("|");
const CALENDAR_EVENT_RUNTIME_SIGNATURE = [
  "myPartstat",
  "myPartstatUpdatedAtMs",
  "myAttendeeEmail",
  "replyRequested",
  "occurrenceMessageIds",
  "emailStatusBackfillV1",
  "emailParticipationBackfillV1"
].join("|");

function ensureCalendarReminderTableSchema(db: any) {
  db.exec(`
    DROP TABLE IF EXISTS calendar_reminders;

    CREATE TABLE IF NOT EXISTS calendar_reminders (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      userId TEXT NOT NULL,
      messageId TEXT,
      eventUid TEXT,
      eventUidKey TEXT,
      eventTitle TEXT NOT NULL,
      eventLocation TEXT,
      eventDescription TEXT,
      eventStartAtMs INTEGER NOT NULL,
      eventEndAtMs INTEGER,
      startTimezone TEXT,
      recurrenceRule TEXT,
      recurrenceDates TEXT,
      excludedDates TEXT,
      leadMinutes INTEGER NOT NULL,
      leadLabel TEXT NOT NULL,
      createdAtMs INTEGER NOT NULL,
      updatedAtMs INTEGER NOT NULL,
      deletedAtMs INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_reminders_account_user_uid
      ON calendar_reminders(accountId, userId, eventUid);
    CREATE INDEX IF NOT EXISTS idx_calendar_reminders_account_user_updated
      ON calendar_reminders(accountId, userId, updatedAtMs DESC);
  `);
}

function getDbTableColumns(db: any, tableName: string) {
  return new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>).map((row) =>
      String(row.name ?? "")
    )
  );
}

function ensureCalendarReminderOptionalColumns(db: any) {
  const reminderColumns = getDbTableColumns(db, "calendar_reminders");
  if (reminderColumns.size === 0) return;
  if (!reminderColumns.has("eventEndAtMs")) {
    db.prepare(`ALTER TABLE calendar_reminders ADD COLUMN eventEndAtMs INTEGER`).run();
  }
  if (!reminderColumns.has("eventDescription")) {
    db.prepare(`ALTER TABLE calendar_reminders ADD COLUMN eventDescription TEXT`).run();
  }
  const hadEventUidKey = reminderColumns.has("eventUidKey");
  if (!hadEventUidKey) {
    db.prepare(`ALTER TABLE calendar_reminders ADD COLUMN eventUidKey TEXT`).run();
  }
  backfillCalendarReminderEventUidKeys(db);
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_calendar_reminders_account_user_uid_key
     ON calendar_reminders(accountId, userId, eventUidKey)`
  ).run();
}

function ensureCalendarReminderRuntimeSchema(db: any) {
  if (calendarReminderSchemaSignatureByDb.get(db) === CALENDAR_REMINDER_SCHEMA_SIGNATURE) {
    return;
  }
  ensureCalendarReminderOptionalColumns(db);
  calendarReminderSchemaSignatureByDb.set(db, CALENDAR_REMINDER_SCHEMA_SIGNATURE);
}

function backfillMessageCalendarEventUidKeys(db: any) {
  const rows = db
    .prepare(
      `SELECT accountId, messageId, eventUid
       FROM message_calendar_events
       WHERE COALESCE(eventUid, '') <> ''
         AND COALESCE(eventUidKey, '') = ''`
    )
    .all() as Array<{
    accountId?: string | null;
    messageId?: string | null;
    eventUid?: string | null;
  }>;
  if (rows.length === 0) return;
  const updateStatement = db.prepare(
    `UPDATE message_calendar_events
     SET eventUidKey = ?
     WHERE accountId = ? AND messageId = ? AND eventUid = ?`
  );
  const runUpdate = db.transaction(
    (
      items: Array<{
        accountId?: string | null;
        messageId?: string | null;
        eventUid?: string | null;
      }>
    ) => {
      items.forEach((row) => {
        const accountId = String(row.accountId ?? "").trim();
        const messageId = String(row.messageId ?? "").trim();
        const eventUid = String(row.eventUid ?? "").trim();
        const eventUidKey = normalizeCalendarEventUidKey(eventUid);
        if (!accountId || !messageId || !eventUid || !eventUidKey) return;
        updateStatement.run(eventUidKey, accountId, messageId, eventUid);
      });
    }
  );
  runUpdate(rows);
}

function ensureMessageCalendarEventOptionalColumns(db: any) {
  const messageCalendarColumns = getDbTableColumns(db, "message_calendar_events");
  if (messageCalendarColumns.size === 0) return;
  const hadEventUidKey = messageCalendarColumns.has("eventUidKey");
  if (!hadEventUidKey) {
    db.prepare(`ALTER TABLE message_calendar_events ADD COLUMN eventUidKey TEXT`).run();
  }
  if (!messageCalendarColumns.has("eventFirstStartAtMs")) {
    db.prepare(`ALTER TABLE message_calendar_events ADD COLUMN eventFirstStartAtMs INTEGER`).run();
  }
  if (!messageCalendarColumns.has("eventLastEndAtMs")) {
    db.prepare(`ALTER TABLE message_calendar_events ADD COLUMN eventLastEndAtMs INTEGER`).run();
  }
  if (!messageCalendarColumns.has("inviteActionType")) {
    db.prepare(`ALTER TABLE message_calendar_events ADD COLUMN inviteActionType TEXT`).run();
  }
  if (!messageCalendarColumns.has("processedAtMs")) {
    db.prepare(`ALTER TABLE message_calendar_events ADD COLUMN processedAtMs INTEGER`).run();
  }
  if (!messageCalendarColumns.has("processedByUserId")) {
    db.prepare(`ALTER TABLE message_calendar_events ADD COLUMN processedByUserId TEXT`).run();
  }
  backfillMessageCalendarEventUidKeys(db);
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_message_calendar_events_account_uid_key
     ON message_calendar_events(accountId, eventUidKey)`
  ).run();
}

function ensureMessageCalendarEventRuntimeSchema(db: any) {
  if (
    messageCalendarEventSchemaSignatureByDb.get(db) ===
    MESSAGE_CALENDAR_EVENT_SCHEMA_SIGNATURE
  ) {
    return;
  }
  ensureMessageCalendarEventOptionalColumns(db);
  messageCalendarEventSchemaSignatureByDb.set(db, MESSAGE_CALENDAR_EVENT_SCHEMA_SIGNATURE);
}

function ensureThreadOptionalColumns(db: any) {
  const threadColumns = getDbTableColumns(db, "threads");
  if (threadColumns.size === 0) return;
  if (!threadColumns.has("latestReceivedDateValue")) {
    db.prepare(`ALTER TABLE threads ADD COLUMN latestReceivedDateValue INTEGER`).run();
  }
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_threads_account_latest_received
     ON threads(accountId, latestReceivedDateValue DESC)`
  ).run();
}

function ensureThreadRuntimeSchema(db: any) {
  if (threadSchemaSignatureByDb.get(db) === THREAD_SCHEMA_SIGNATURE) {
    return;
  }
  ensureThreadOptionalColumns(db);
  threadSchemaSignatureByDb.set(db, THREAD_SCHEMA_SIGNATURE);
}

function ensureCalendarEventOptionalColumns(db: any) {
  const calendarEventColumns = getDbTableColumns(db, "calendar_events");
  if (calendarEventColumns.size === 0) return;
  if (!calendarEventColumns.has("myPartstat")) {
    db.prepare(`ALTER TABLE calendar_events ADD COLUMN myPartstat TEXT`).run();
  }
  if (!calendarEventColumns.has("myPartstatUpdatedAtMs")) {
    db.prepare(`ALTER TABLE calendar_events ADD COLUMN myPartstatUpdatedAtMs INTEGER`).run();
  }
  if (!calendarEventColumns.has("myAttendeeEmail")) {
    db.prepare(`ALTER TABLE calendar_events ADD COLUMN myAttendeeEmail TEXT`).run();
  }
  if (!calendarEventColumns.has("replyRequested")) {
    db.prepare(`ALTER TABLE calendar_events ADD COLUMN replyRequested INTEGER`).run();
  }
  if (!calendarEventColumns.has("occurrenceMessageIds")) {
    db.prepare(`ALTER TABLE calendar_events ADD COLUMN occurrenceMessageIds TEXT`).run();
  }
}

function backfillEmailCalendarEventStatuses(db: any) {
  const rows = db
    .prepare(
      `SELECT id, eventUid, status, rawIcs
       FROM calendar_events
       WHERE sourceType = 'email'
         AND deletedAtMs IS NULL
         AND COALESCE(rawIcs, '') <> ''`
    )
    .all() as Array<{
    id?: string | null;
    eventUid?: string | null;
    status?: string | null;
    rawIcs?: string | null;
  }>;
  if (rows.length === 0) return;

  const updates = rows.flatMap((row) => {
    const id = String(row.id ?? "").trim();
    const eventUid = String(row.eventUid ?? "").trim();
    const rawIcs = String(row.rawIcs ?? "");
    if (!id || !eventUid || !rawIcs.trim()) return [];

    const nextStatus = extractEmailCalendarEventStatusFromIcs(rawIcs, eventUid) ?? null;
    const currentStatus = normalizeCalendarEventStatus(row.status);
    if ((nextStatus ?? null) === (currentStatus ?? null)) return [];
    return [{ id, status: nextStatus }];
  });
  if (updates.length === 0) return;

  const updateStatement = db.prepare(
    `UPDATE calendar_events
     SET status = ?, updatedAtMs = ?
     WHERE id = ?`
  );
  const now = Date.now();
  const runUpdate = db.transaction((items: Array<{ id: string; status: string | null }>) => {
    items.forEach((item) => {
      updateStatement.run(item.status, now, item.id);
    });
  });
  runUpdate(updates);
}

function backfillEmailCalendarEventParticipation(db: any, accountEmail?: string | null) {
  const normalizedAccountEmail = accountEmail?.trim();
  if (!normalizedAccountEmail) return;
  const rows = db
    .prepare(
      `SELECT id, eventUid, attendees, myPartstat, myPartstatUpdatedAtMs, myAttendeeEmail, replyRequested, rawIcs
       FROM calendar_events
       WHERE deletedAtMs IS NULL
         AND COALESCE(rawIcs, '') <> ''`
    )
    .all() as Array<{
    id?: string | null;
    eventUid?: string | null;
    attendees?: string | null;
    myPartstat?: string | null;
    myPartstatUpdatedAtMs?: number | null;
    myAttendeeEmail?: string | null;
    replyRequested?: number | null;
    rawIcs?: string | null;
  }>;
  if (rows.length === 0) return;

  const updateStatement = db.prepare(
    `UPDATE calendar_events
     SET attendees = ?, myPartstat = ?, myPartstatUpdatedAtMs = ?, myAttendeeEmail = ?, replyRequested = ?, updatedAtMs = ?
     WHERE id = ?`
  );
  const now = Date.now();
  const updates = rows.flatMap((row) => {
    const id = String(row.id ?? "").trim();
    const eventUid = String(row.eventUid ?? "").trim();
    const rawIcs = String(row.rawIcs ?? "");
    if (!id || !eventUid || !rawIcs.trim()) return [];
    const group = collectCalendarInviteMutationGroups(rawIcs).find(
      (item) => item.eventUid.trim().toLowerCase() === eventUid.toLowerCase()
    );
    const participation = mergeCalendarParticipation(
      {
        attendees: row.attendees ?? undefined,
        myPartstat: normalizeCalendarParticipationStatus(row.myPartstat),
        myPartstatUpdatedAtMs:
          typeof row.myPartstatUpdatedAtMs === "number" ? row.myPartstatUpdatedAtMs : undefined,
        myAttendeeEmail: row.myAttendeeEmail ?? undefined,
        replyRequested:
          row.replyRequested == null ? undefined : Boolean(row.replyRequested)
      },
      resolveCalendarParticipationFromPreview(group?.baseEvent ?? {}, normalizedAccountEmail),
      now
    );
    const nextReplyRequested =
      typeof participation.replyRequested === "boolean" ? Number(participation.replyRequested) : null;
    const currentReplyRequested = row.replyRequested == null ? null : Number(Boolean(row.replyRequested));
    if (
      (participation.attendees ?? null) === (row.attendees ?? null) &&
      (participation.myPartstat ?? null) === (row.myPartstat ?? null) &&
      (participation.myPartstatUpdatedAtMs ?? null) === (row.myPartstatUpdatedAtMs ?? null) &&
      (participation.myAttendeeEmail ?? null) === (row.myAttendeeEmail ?? null) &&
      nextReplyRequested === currentReplyRequested
    ) {
      return [];
    }
    return [{
      id,
      attendees: participation.attendees ?? null,
      myPartstat: participation.myPartstat ?? null,
      myPartstatUpdatedAtMs: participation.myPartstatUpdatedAtMs ?? null,
      myAttendeeEmail: participation.myAttendeeEmail ?? null,
      replyRequested: nextReplyRequested
    }];
  });
  if (updates.length === 0) return;

  const runUpdate = db.transaction(
    (
      items: Array<{
        id: string;
        attendees: string | null;
        myPartstat: string | null;
        myPartstatUpdatedAtMs: number | null;
        myAttendeeEmail: string | null;
        replyRequested: number | null;
      }>
    ) => {
      items.forEach((item) => {
        updateStatement.run(
          item.attendees,
          item.myPartstat,
          item.myPartstatUpdatedAtMs,
          item.myAttendeeEmail,
          item.replyRequested,
          now,
          item.id
        );
      });
    }
  );
  runUpdate(updates);
}

async function ensureCalendarEventRuntimeData(db: any, accountId: string) {
  if (calendarEventRuntimeSignatureByDb.get(db) === CALENDAR_EVENT_RUNTIME_SIGNATURE) {
    return;
  }
  ensureCalendarEventOptionalColumns(db);
  backfillEmailCalendarEventStatuses(db);
  const account = await getAccountById(accountId);
  backfillEmailCalendarEventParticipation(db, account?.email);
  calendarEventRuntimeSignatureByDb.set(db, CALENDAR_EVENT_RUNTIME_SIGNATURE);
}

async function ensureDatabaseCtor() {
  if (DatabaseCtor) return;
  try {
    const sqliteModule = await sqliteModulePromise();
    DatabaseCtor = sqliteModule.Database as any;
  } catch {
    throw new Error("bun:sqlite is unavailable in this runtime. Run the app with Bun (not Node).");
  }
}

function configureDb(db: any) {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 15000;");
  db.exec("PRAGMA foreign_keys = ON;");
}

function ensureDbParentDir(dbPath: string) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
}

function clearAccountDbIdleTimer(dbPath: string) {
  const timer = accountDbIdleTimers.get(dbPath);
  if (timer) {
    clearTimeout(timer);
    accountDbIdleTimers.delete(dbPath);
  }
}

function closeAccountDbConnection(dbPath: string) {
  clearAccountDbIdleTimer(dbPath);
  const db = accountDbInstances.get(dbPath);
  if (!db) return;
  try {
    db.close();
  } catch {
    // ignore close failures during shutdown/eviction
  }
  accountDbInstances.delete(dbPath);
  accountDbInitialized.delete(dbPath);
}

async function unlinkIfExists(filePath: string) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
    if (code !== "ENOENT") {
      console.warn("[account-lifecycle] failed to delete file", { filePath, error });
    }
  }
}

async function cleanupAccountLifecycleArtifacts(
  accountId: string,
  dbPath: string,
  deleteShardFile: boolean
) {
  await Promise.all([
    fs.rm(getSourcesAccountDir(accountId), { recursive: true, force: true }).catch((error) => {
      console.warn("[account-lifecycle] failed to delete source cache dir", { accountId, error });
    }),
    fs.rm(getAttachmentsAccountDir(accountId), { recursive: true, force: true }).catch((error) => {
      console.warn("[account-lifecycle] failed to delete attachment cache dir", { accountId, error });
    })
  ]);

  if (!deleteShardFile) return;
  await Promise.all([
    unlinkIfExists(dbPath),
    unlinkIfExists(`${dbPath}-wal`),
    unlinkIfExists(`${dbPath}-shm`)
  ]);
}

function scheduleAccountDbIdleClose(dbPath: string) {
  if (ACCOUNT_DB_IDLE_MS <= 0) return;
  clearAccountDbIdleTimer(dbPath);
  const timer = setTimeout(() => {
    closeAccountDbConnection(dbPath);
  }, ACCOUNT_DB_IDLE_MS);
  timer.unref?.();
  accountDbIdleTimers.set(dbPath, timer);
}

export function closeAllDbConnections() {
  const accountPaths = Array.from(accountDbInstances.keys());
  accountPaths.forEach((dbPath) => closeAccountDbConnection(dbPath));
  if (masterDbInstance) {
    try {
      masterDbInstance.close();
    } catch {
      // ignore close failures during shutdown
    }
    masterDbInstance = null;
    masterInitialized = false;
  }
}

function registerDbShutdownHooks() {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;
  process.once("SIGINT", closeAllDbConnections);
  process.once("SIGTERM", closeAllDbConnections);
  process.once("beforeExit", closeAllDbConnections);
}

function mapInviteRow(row: any): InviteCode {
  return {
    code: row.code,
    role: row.role,
    maxUses: row.maxUses === null ? null : Number(row.maxUses),
    uses: row.uses ?? 0,
    expiresAt: row.expiresAt === null ? null : Number(row.expiresAt),
    createdAt: Number(row.createdAt ?? 0),
    usedByUserId: row.usedByUserId ?? null
  };
}

function mapUserRow(row: any): User {
  return {
    id: row.id,
    email: row.email,
    role: row.role === "admin" ? "admin" : "user",
    createdAt: Number(row.createdAt ?? 0)
  };
}

function createAdminInvite(db: any): InviteCode {
  const adminInvite: InviteCode = {
    code: randomUUID(),
    role: "admin",
    maxUses: 1,
    uses: 0,
    expiresAt: null,
    createdAt: Date.now(),
    usedByUserId: null
  };
  db.prepare(
    `INSERT INTO invite_codes (code, role, maxUses, uses, expiresAt, createdAt, usedByUserId)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    adminInvite.code,
    adminInvite.role,
    adminInvite.maxUses,
    adminInvite.uses,
    adminInvite.expiresAt,
    adminInvite.createdAt,
    adminInvite.usedByUserId
  );
  return adminInvite;
}

function getUsableAdminInvite(db: any): InviteCode | null {
  const row = db
    .prepare(
      `SELECT code, role, maxUses, uses, expiresAt, createdAt, usedByUserId
       FROM invite_codes
       WHERE role = 'admin'
         AND (expiresAt IS NULL OR expiresAt >= ?)
         AND (maxUses IS NULL OR uses < maxUses)
       ORDER BY uses ASC, code ASC
       LIMIT 1`
    )
    .get(Date.now()) as any;
  if (!row) return null;
  return mapInviteRow(row);
}

function ensureAdminInvite(db: any): InviteCode {
  return getUsableAdminInvite(db) ?? createAdminInvite(db);
}

function initMasterSchema(db: any) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      avatar TEXT NOT NULL,
      ownerUserId TEXT,
      settings TEXT,
      dbPath TEXT,
      imapHost TEXT NOT NULL,
      imapPort INTEGER NOT NULL,
      imapSecure INTEGER NOT NULL,
      imapUser TEXT NOT NULL,
      imapPassword TEXT NOT NULL,
      smtpHost TEXT NOT NULL,
      smtpPort INTEGER NOT NULL,
      smtpSecure INTEGER NOT NULL,
      smtpUser TEXT NOT NULL,
      smtpPassword TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_accounts (
      userId TEXT NOT NULL,
      accountId TEXT NOT NULL,
      PRIMARY KEY (userId, accountId)
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      maxUses INTEGER,
      uses INTEGER DEFAULT 0,
      expiresAt INTEGER,
      createdAt INTEGER NOT NULL,
      usedByUserId TEXT
    );
  `);

  const inviteColumns = new Set(
    (db.prepare(`PRAGMA table_info(invite_codes)`).all() as Array<{ name?: string }>).map((row) =>
      String(row.name ?? "")
    )
  );
  if (!inviteColumns.has("createdAt")) {
    db.prepare(`ALTER TABLE invite_codes ADD COLUMN createdAt INTEGER`).run();
    db.prepare(`UPDATE invite_codes SET createdAt = ? WHERE createdAt IS NULL`).run(Date.now());
  }
  if (!inviteColumns.has("usedByUserId")) {
    db.prepare(`ALTER TABLE invite_codes ADD COLUMN usedByUserId TEXT`).run();
  }

  const accountColumns = new Set(
    (db.prepare(`PRAGMA table_info(accounts)`).all() as Array<{ name?: string }>).map((row) =>
      String(row.name ?? "")
    )
  );
  if (!accountColumns.has("caldavUrl")) {
    db.prepare(`ALTER TABLE accounts ADD COLUMN caldavUrl TEXT`).run();
  }
  if (!accountColumns.has("caldavUser")) {
    db.prepare(`ALTER TABLE accounts ADD COLUMN caldavUser TEXT`).run();
  }
  if (!accountColumns.has("caldavPassword")) {
    db.prepare(`ALTER TABLE accounts ADD COLUMN caldavPassword TEXT`).run();
  }
  if (!accountColumns.has("caldavCalendarPath")) {
    db.prepare(`ALTER TABLE accounts ADD COLUMN caldavCalendarPath TEXT`).run();
  }
  if (!accountColumns.has("caldavSyncIntervalMs")) {
    db.prepare(`ALTER TABLE accounts ADD COLUMN caldavSyncIntervalMs INTEGER`).run();
  }

  const userCount = db.prepare(`SELECT COUNT(*) as count FROM users`).get() as { count: number };
  if (userCount.count === 0) {
    const adminInvite = ensureAdminInvite(db);
    console.info(`[noctua] Admin invite code: ${adminInvite.code}`);
  }
}

function initAccountSchema(db: any) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parentId TEXT,
      accountId TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      specialUse TEXT,
      flags TEXT,
      delimiter TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      folderId TEXT NOT NULL,
      threadId TEXT NOT NULL,
      parentId TEXT,
      messageId TEXT,
      inReplyTo TEXT,
      "references" TEXT,
      xForwardedMessageId TEXT,
      xComposeFormat TEXT,
      quotedHtmlEdited INTEGER DEFAULT 0,
      subject TEXT NOT NULL,
      fromAddr TEXT NOT NULL,
      fromEmail TEXT,
      toAddr TEXT NOT NULL,
      ccAddr TEXT,
      bccAddr TEXT,
      mailboxPath TEXT,
      imapUid INTEGER,
      preview TEXT NOT NULL,
      date TEXT NOT NULL,
      dateValue INTEGER NOT NULL,
      body TEXT NOT NULL,
      htmlBody TEXT,
      priority TEXT,
      hasSource INTEGER DEFAULT 0,
      unread INTEGER DEFAULT 0,
      flags TEXT,
      seen INTEGER DEFAULT 0,
      answered INTEGER DEFAULT 0,
      flagged INTEGER DEFAULT 0,
      deleted INTEGER DEFAULT 0,
      draft INTEGER DEFAULT 0,
      recent INTEGER DEFAULT 0,
      category TEXT,
      categoryScore REAL,
      categorySignals TEXT,
      categoryManualState TEXT,
      listId TEXT
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      messageId TEXT NOT NULL,
      filename TEXT NOT NULL,
      contentType TEXT NOT NULL,
      size INTEGER NOT NULL,
      inline INTEGER NOT NULL,
      cid TEXT,
      url TEXT,
      FOREIGN KEY(messageId) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_calendar_events (
      accountId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      eventUid TEXT NOT NULL,
      eventUidKey TEXT,
      eventFirstStartAtMs INTEGER,
      eventLastEndAtMs INTEGER,
      inviteActionType TEXT,
      processedAtMs INTEGER,
      processedByUserId TEXT,
      PRIMARY KEY (accountId, messageId, eventUid),
      FOREIGN KEY(messageId) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS threads (
      threadId TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      rootMessageId TEXT,
      latestMessageId TEXT,
      latestDateValue INTEGER,
      latestReceivedDateValue INTEGER,
      messageCount INTEGER,
      unreadCount INTEGER
    );

    CREATE TABLE IF NOT EXISTS mailbox_state (
      folderId TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      mailboxPath TEXT NOT NULL,
      uidValidity TEXT,
      highestModSeq TEXT,
      highestUid INTEGER,
      supportsQresync INTEGER
    );

    CREATE TABLE IF NOT EXISTS category_model_state (
      accountId TEXT PRIMARY KEY,
      modelJson TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS category_feedback_events (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      messageId TEXT NOT NULL,
      previousCategory TEXT,
      nextCategory TEXT,
      featureJson TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      imapKeyword TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS thread_topics (
      threadId TEXT NOT NULL,
      topicId TEXT NOT NULL,
      accountId TEXT NOT NULL,
      assignedAt INTEGER NOT NULL,
      PRIMARY KEY (threadId, topicId)
    );

    CREATE TABLE IF NOT EXISTS thread_signals (
      accountId TEXT NOT NULL,
      threadId TEXT NOT NULL,
      signalType TEXT NOT NULL,
      signalValue TEXT NOT NULL,
      PRIMARY KEY (accountId, threadId, signalType, signalValue)
    );

    CREATE TABLE IF NOT EXISTS topic_learning_signals (
      accountId TEXT NOT NULL,
      topicId TEXT NOT NULL,
      threadId TEXT NOT NULL,
      signalType TEXT NOT NULL,
      signalValue TEXT NOT NULL,
      PRIMARY KEY (accountId, topicId, threadId, signalType, signalValue)
    );

    CREATE TABLE IF NOT EXISTS calendar_reminders (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      userId TEXT NOT NULL,
      messageId TEXT,
      eventUid TEXT,
      eventUidKey TEXT,
      eventTitle TEXT NOT NULL,
      eventLocation TEXT,
      eventDescription TEXT,
      eventStartAtMs INTEGER NOT NULL,
      eventEndAtMs INTEGER,
      startTimezone TEXT,
      recurrenceRule TEXT,
      recurrenceDates TEXT,
      excludedDates TEXT,
      leadMinutes INTEGER NOT NULL,
      leadLabel TEXT NOT NULL,
      createdAtMs INTEGER NOT NULL,
      updatedAtMs INTEGER NOT NULL,
      deletedAtMs INTEGER
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS message_fts
    USING fts5(messageId, subject, fromAddr, toAddr, ccAddr, bccAddr, body, preview);

    CREATE INDEX IF NOT EXISTS idx_messages_account_folder_date
      ON messages(accountId, folderId, dateValue DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_account_date
      ON messages(accountId, dateValue DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_thread
      ON messages(threadId);
    CREATE INDEX IF NOT EXISTS idx_messages_account_thread_date
      ON messages(accountId, threadId, dateValue DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_account_flagged_thread
      ON messages(accountId, flagged, threadId);
    CREATE INDEX IF NOT EXISTS idx_messages_account_flagged_date
      ON messages(accountId, flagged DESC, dateValue DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_account_folder_flagged_date
      ON messages(accountId, folderId, flagged DESC, dateValue DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_category
      ON messages(accountId, category, dateValue DESC);
    CREATE INDEX IF NOT EXISTS idx_threads_account_latest
      ON threads(accountId, latestDateValue DESC);
    CREATE INDEX IF NOT EXISTS idx_attachments_message
      ON attachments(messageId);
    CREATE INDEX IF NOT EXISTS idx_message_calendar_events_account_uid
      ON message_calendar_events(accountId, eventUid);
    CREATE INDEX IF NOT EXISTS idx_message_calendar_events_account_message
      ON message_calendar_events(accountId, messageId);
    CREATE INDEX IF NOT EXISTS idx_calendar_reminders_account_user_uid
      ON calendar_reminders(accountId, userId, eventUid);
    CREATE INDEX IF NOT EXISTS idx_calendar_reminders_account_user_updated
      ON calendar_reminders(accountId, userId, updatedAtMs DESC);
    CREATE INDEX IF NOT EXISTS idx_category_feedback_events_account_created
      ON category_feedback_events(accountId, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_topics_account
      ON topics(accountId);
    CREATE INDEX IF NOT EXISTS idx_thread_topics_thread
      ON thread_topics(threadId);
    CREATE INDEX IF NOT EXISTS idx_thread_topics_topic
      ON thread_topics(topicId);
    CREATE INDEX IF NOT EXISTS idx_thread_signals_account_thread
      ON thread_signals(accountId, threadId);
    CREATE INDEX IF NOT EXISTS idx_thread_signals_account_signal
      ON thread_signals(accountId, signalType, signalValue, threadId);
    CREATE INDEX IF NOT EXISTS idx_topic_learning_signals_account_topic
      ON topic_learning_signals(accountId, topicId, threadId);
    CREATE INDEX IF NOT EXISTS idx_topic_learning_signals_account_signal
      ON topic_learning_signals(accountId, signalType, signalValue, topicId, threadId);

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      calendarId TEXT,
      eventUid TEXT NOT NULL,
      summary TEXT NOT NULL,
      description TEXT,
      location TEXT,
      startAtMs INTEGER NOT NULL,
      endAtMs INTEGER,
      allDay INTEGER NOT NULL DEFAULT 0,
      startTimezone TEXT,
      endTimezone TEXT,
      recurrenceRule TEXT,
      recurrenceDates TEXT,
      excludedDates TEXT,
      status TEXT,
      organizer TEXT,
      attendees TEXT,
      myPartstat TEXT,
      myPartstatUpdatedAtMs INTEGER,
      myAttendeeEmail TEXT,
      replyRequested INTEGER,
      remoteEtag TEXT,
      remoteHref TEXT,
      rawIcs TEXT,
      sourceType TEXT NOT NULL DEFAULT 'local',
      messageId TEXT,
      occurrenceMessageIds TEXT,
      createdAtMs INTEGER NOT NULL,
      updatedAtMs INTEGER NOT NULL,
      deletedAtMs INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_events_account_start
      ON calendar_events(accountId, startAtMs);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_account_uid
      ON calendar_events(accountId, eventUid);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_account_source
      ON calendar_events(accountId, sourceType);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_account_calendar
      ON calendar_events(accountId, calendarId);

    CREATE TABLE IF NOT EXISTS calendar_participation_overrides (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      eventUid TEXT NOT NULL,
      occurrenceStartAtMs INTEGER NOT NULL,
      partstat TEXT NOT NULL,
      attendeeEmail TEXT,
      updatedAtMs INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_participation_overrides_account_uid_occurrence
      ON calendar_participation_overrides(accountId, eventUid, occurrenceStartAtMs);
  `);

  // Lightweight schema migration for existing account DBs.
  const messageColumns = new Set(
    (db.prepare(`PRAGMA table_info(messages)`).all() as Array<{ name?: string }>).map((row) =>
      String(row.name ?? "")
    )
  );
  if (!messageColumns.has("categorySignals")) {
    db.prepare(`ALTER TABLE messages ADD COLUMN categorySignals TEXT`).run();
  }
  if (!messageColumns.has("categoryManualState")) {
    db.prepare(`ALTER TABLE messages ADD COLUMN categoryManualState TEXT`).run();
    db.prepare(
      `UPDATE messages
       SET categoryManualState = 'cleared'
       WHERE category IS NULL
         AND COALESCE(categorySignals, '') LIKE '%manual-category:cleared%'`
    ).run();
  }
  if (!messageColumns.has("listUnsubscribe")) {
    db.prepare(`ALTER TABLE messages ADD COLUMN listUnsubscribe TEXT`).run();
  }
  if (!messageColumns.has("listId")) {
    db.prepare(`ALTER TABLE messages ADD COLUMN listId TEXT`).run();
  }
  if (!messageColumns.has("xComposeFormat")) {
    db.prepare(`ALTER TABLE messages ADD COLUMN xComposeFormat TEXT`).run();
  }
  if (!messageColumns.has("quotedHtmlEdited")) {
    db.prepare(`ALTER TABLE messages ADD COLUMN quotedHtmlEdited INTEGER DEFAULT 0`).run();
  }
  ensureThreadOptionalColumns(db);
  ensureMessageCalendarEventOptionalColumns(db);

  const reminderColumns = getDbTableColumns(db, "calendar_reminders");
  if (reminderColumns.size > 0) {
    const requiredColumns = [
      "id",
      "accountId",
      "userId",
      "eventTitle",
      "eventStartAtMs",
      "startTimezone",
      "recurrenceRule",
      "recurrenceDates",
      "excludedDates",
      "leadMinutes",
      "leadLabel",
      "createdAtMs",
      "updatedAtMs",
      "deletedAtMs"
    ];
    const requiresRecreate = requiredColumns.some((column) => !reminderColumns.has(column));
    if (requiresRecreate) {
      ensureCalendarReminderTableSchema(db);
    }
    ensureCalendarReminderOptionalColumns(db);
  }
}

type ThreadSignalSourceRow = TopicSignalSource & {
  threadId?: string | null;
  toAddr?: string | null;
  ccAddr?: string | null;
};

function normalizeThreadIds(threadIds?: Array<string | null | undefined>) {
  return Array.from(new Set((threadIds ?? []).map((threadId) => (threadId ?? "").trim()).filter(Boolean)));
}

function insertThreadSignalsFromMessageRows(
  db: any,
  accountId: string,
  rows: ThreadSignalSourceRow[],
  options?: {
    accountEmail?: string | null;
  }
) {
  const insertThreadSignal = db.prepare(
    `INSERT OR REPLACE INTO thread_signals (accountId, threadId, signalType, signalValue)
     VALUES (?, ?, ?, ?)`
  );
  let activeThreadId = "";
  let activeRows: TopicSignalSource[] = [];
  const flush = () => {
    if (!activeThreadId || activeRows.length === 0) return;
    collectTopicSignalEntries(activeRows, {
      excludeAccountEmail: options?.accountEmail ?? null
    }).forEach((entry) => {
      insertThreadSignal.run(accountId, activeThreadId, entry.type, entry.value);
    });
  };

  rows.forEach((row) => {
    const threadId = (row.threadId ?? "").trim();
    if (!threadId) return;
    if (threadId !== activeThreadId) {
      flush();
      activeThreadId = threadId;
      activeRows = [];
    }
    activeRows.push({
      fromEmail: row.fromEmail,
      to: row.toAddr,
      cc: row.ccAddr,
      listId: row.listId,
      subject: row.subject,
      messageId: row.messageId
    });
  });
  flush();
}

function rebuildThreadSignalsForThreadIdsInternal(
  db: any,
  accountId: string,
  threadIds: string[],
  accountEmail?: string | null
) {
  const uniqueThreadIds = normalizeThreadIds(threadIds);
  if (uniqueThreadIds.length === 0) return;

  const deleteBatchSize = 400;
  for (let start = 0; start < uniqueThreadIds.length; start += deleteBatchSize) {
    const chunk = uniqueThreadIds.slice(start, start + deleteBatchSize);
    db.prepare(
      `DELETE FROM thread_signals
       WHERE accountId = ?
         AND threadId IN (${chunk.map(() => "?").join(",")})`
    ).run(accountId, ...chunk);
  }

  const selectedRows: ThreadSignalSourceRow[] = [];
  const selectBatchSize = 400;
  for (let start = 0; start < uniqueThreadIds.length; start += selectBatchSize) {
    const chunk = uniqueThreadIds.slice(start, start + selectBatchSize);
    const rows = db
      .prepare(
      `SELECT threadId, fromEmail, toAddr, ccAddr, listId, subject, messageId
         FROM messages
         WHERE accountId = ?
           AND threadId IN (${chunk.map(() => "?").join(",")})
         ORDER BY threadId ASC, dateValue ASC, id ASC`
      )
      .all(accountId, ...chunk) as ThreadSignalSourceRow[];
    selectedRows.push(...rows);
  }

  insertThreadSignalsFromMessageRows(db, accountId, selectedRows, { accountEmail });
}

async function rebuildThreadSignalsForThreadIds(db: any, accountId: string, threadIds: string[]) {
  const accountEmail = await getAccountEmail(accountId);
  rebuildThreadSignalsForThreadIdsInternal(db, accountId, threadIds, accountEmail);
}

function rebuildAllThreadSignalsForAccountInternal(
  db: any,
  accountId: string,
  accountEmail?: string | null
) {
  db.prepare(`DELETE FROM thread_signals WHERE accountId = ?`).run(accountId);
  const rows = db
    .prepare(
      `SELECT threadId, fromEmail, toAddr, ccAddr, listId, subject, messageId
       FROM messages
       WHERE accountId = ?
       ORDER BY threadId ASC, dateValue ASC, id ASC`
    )
    .all(accountId) as ThreadSignalSourceRow[];
  insertThreadSignalsFromMessageRows(db, accountId, rows, { accountEmail });
}

async function rebuildAllThreadSignalsForAccount(db: any, accountId: string) {
  const accountEmail = await getAccountEmail(accountId);
  rebuildAllThreadSignalsForAccountInternal(db, accountId, accountEmail);
}

async function ensureThreadSignalRuntimeData(db: any, accountId: string) {
  const hasThreadSignals = db
    .prepare(`SELECT 1 FROM thread_signals WHERE accountId = ? LIMIT 1`)
    .get(accountId);
  if (hasThreadSignals) return;
  const hasMessages = db
    .prepare(`SELECT 1 FROM messages WHERE accountId = ? LIMIT 1`)
    .get(accountId);
  if (!hasMessages) return;
  await rebuildAllThreadSignalsForAccount(db, accountId);
}

function normalizeTopicIds(topicIds?: Array<string | null | undefined>) {
  return Array.from(new Set((topicIds ?? []).map((topicId) => (topicId ?? "").trim()).filter(Boolean)));
}

export function deleteTopicLearningSignals(
  db: any,
  accountId: string,
  options?: {
    threadIds?: string[];
    topicIds?: string[];
  }
) {
  const uniqueThreadIds = normalizeThreadIds(options?.threadIds);
  const uniqueTopicIds = normalizeTopicIds(options?.topicIds);
  if (uniqueThreadIds.length === 0 && uniqueTopicIds.length === 0) return;

  const clauses = [`accountId = ?`];
  const args: any[] = [accountId];
  if (uniqueThreadIds.length > 0) {
    clauses.push(`threadId IN (${uniqueThreadIds.map(() => "?").join(",")})`);
    args.push(...uniqueThreadIds);
  }
  if (uniqueTopicIds.length > 0) {
    clauses.push(`topicId IN (${uniqueTopicIds.map(() => "?").join(",")})`);
    args.push(...uniqueTopicIds);
  }

  db.prepare(
    `DELETE FROM topic_learning_signals
     WHERE ${clauses.join(" AND ")}`
  ).run(...args);
}

export function upsertTopicLearningSignalsForThreadIds(
  db: any,
  accountId: string,
  threadIds: string[],
  options?: {
    topicIds?: string[];
  }
) {
  const uniqueThreadIds = normalizeThreadIds(threadIds);
  if (uniqueThreadIds.length === 0) return;
  const uniqueTopicIds = normalizeTopicIds(options?.topicIds);
  const insertLearningSignal = db.prepare(
    `INSERT OR IGNORE INTO topic_learning_signals (accountId, topicId, threadId, signalType, signalValue)
     VALUES (?, ?, ?, ?, ?)`
  );

  const selectBatchSize = 300;
  const topicClause =
    uniqueTopicIds.length > 0 ? `AND tt.topicId IN (${uniqueTopicIds.map(() => "?").join(",")})` : "";
  for (let start = 0; start < uniqueThreadIds.length; start += selectBatchSize) {
    const chunk = uniqueThreadIds.slice(start, start + selectBatchSize);
    const rows = db
      .prepare(
        `SELECT tt.topicId, ts.threadId, ts.signalType, ts.signalValue
         FROM thread_topics tt
         JOIN thread_signals ts ON ts.accountId = tt.accountId AND ts.threadId = tt.threadId
         WHERE tt.accountId = ?
           AND tt.threadId IN (${chunk.map(() => "?").join(",")})
           ${topicClause}`
      )
      .all(accountId, ...chunk, ...uniqueTopicIds) as Array<{
      topicId?: string | null;
      threadId?: string | null;
      signalType?: string | null;
      signalValue?: string | null;
    }>;

    rows.forEach((row) => {
      const topicId = (row.topicId ?? "").trim();
      const threadId = (row.threadId ?? "").trim();
      const signalType = (row.signalType ?? "").trim();
      const signalValue = (row.signalValue ?? "").trim();
      if (!topicId || !threadId || !signalType || !signalValue) return;
      insertLearningSignal.run(accountId, topicId, threadId, signalType, signalValue);
    });
  }
}

function ensureTopicLearningRuntimeData(db: any, accountId: string) {
  const hasTopicLearningSignals = db
    .prepare(`SELECT 1 FROM topic_learning_signals WHERE accountId = ? LIMIT 1`)
    .get(accountId);
  if (hasTopicLearningSignals) return;
  const threadRows = db
    .prepare(
      `SELECT DISTINCT threadId
       FROM thread_topics
       WHERE accountId = ?`
    )
    .all(accountId) as Array<{ threadId?: string | null }>;
  if (threadRows.length === 0) return;
  upsertTopicLearningSignalsForThreadIds(
    db,
    accountId,
    threadRows.map((row) => row.threadId ?? "")
  );
}

function pruneThreadTopicsWithoutMessages(db: any, accountId: string, threadIds: string[]) {
  const uniqueThreadIds = normalizeThreadIds(threadIds);
  if (uniqueThreadIds.length === 0) return;

  const deleteBatchSize = 400;
  for (let start = 0; start < uniqueThreadIds.length; start += deleteBatchSize) {
    const chunk = uniqueThreadIds.slice(start, start + deleteBatchSize);
    db.prepare(
      `DELETE FROM thread_topics
       WHERE accountId = ?
         AND threadId IN (${chunk.map(() => "?").join(",")})
         AND NOT EXISTS (
           SELECT 1
           FROM messages m
           WHERE m.accountId = thread_topics.accountId
             AND m.threadId = thread_topics.threadId
         )`
    ).run(accountId, ...chunk);
  }
}

async function getDb() {
  registerDbShutdownHooks();
  if (!masterDbInstance) {
    await ensureDatabaseCtor();
    const dbPath = getMainDbPath();
    ensureDbParentDir(dbPath);
    masterDbInstance = new DatabaseCtor(dbPath);
    configureDb(masterDbInstance);
  }
  if (!masterInitialized && masterDbInstance) {
    initMasterSchema(masterDbInstance);
    masterInitialized = true;
  }
  return masterDbInstance;
}

export async function initializeMasterDb() {
  await getDb();
}

async function resolveAccountDbPath(accountId: string) {
  const master = await getDb();
  const row = master
    .prepare(`SELECT id, dbPath FROM accounts WHERE id = ?`)
    .get(accountId) as { id?: string; dbPath?: string | null } | undefined;
  const defaultPath = getDefaultAccountDbPath(accountId);
  if (!row?.id) {
    return defaultPath;
  }
  if (row.dbPath && row.dbPath.trim().length > 0) {
    return row.dbPath;
  }
  master.prepare(`UPDATE accounts SET dbPath = ? WHERE id = ?`).run(defaultPath, accountId);
  return defaultPath;
}

async function getAccountDb(accountId: string) {
  const dbPath = await resolveAccountDbPath(accountId);
  if (!accountDbInstances.has(dbPath)) {
    await ensureDatabaseCtor();
    ensureDbParentDir(dbPath);
    const accountDb = new DatabaseCtor(dbPath);
    configureDb(accountDb);
    accountDbInstances.set(dbPath, accountDb);
  }
  const accountDb = accountDbInstances.get(dbPath)!;
  if (!accountDbInitialized.has(dbPath)) {
    initAccountSchema(accountDb);
    accountDbInitialized.add(dbPath);
  }
  ensureThreadRuntimeSchema(accountDb);
  ensureMessageCalendarEventRuntimeSchema(accountDb);
  ensureCalendarReminderRuntimeSchema(accountDb);
  await ensureCalendarEventRuntimeData(accountDb, accountId);
  await ensureThreadSignalRuntimeData(accountDb, accountId);
  ensureTopicLearningRuntimeData(accountDb, accountId);
  scheduleAccountDbIdleClose(dbPath);
  return accountDb;
}

export type GroupMeta = { key: string; label: string; count: number };

export async function withAccountDb<T>(accountId: string, fn: (db: any) => T | Promise<T>): Promise<T> {
  const db = await getAccountDb(accountId);
  return fn(db);
}

function resolveAccountDbPathForPersist(accountId: string, dbPath?: string | null) {
  if (dbPath && dbPath.trim().length > 0) return dbPath;
  return getDefaultAccountDbPath(accountId);
}

function mapAccountRow(row: any): Account {
  const caldav: CaldavConfig | undefined =
    row.caldavUrl && String(row.caldavUrl).trim()
      ? {
          url: String(row.caldavUrl),
          user: String(row.caldavUser ?? ""),
          password: decodeSecret(String(row.caldavPassword ?? "")),
          calendarPath: row.caldavCalendarPath ? String(row.caldavCalendarPath) : undefined,
          syncIntervalMs:
            row.caldavSyncIntervalMs != null && Number.isFinite(Number(row.caldavSyncIntervalMs))
              ? Number(row.caldavSyncIntervalMs)
              : undefined
        }
      : undefined;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatar: row.avatar,
    settings: normalizeAccountSettings(row.settings ? (JSON.parse(row.settings) as any) : undefined),
    caldav,
    imap: {
      host: row.imapHost,
      port: row.imapPort,
      secure: Boolean(row.imapSecure),
      user: row.imapUser,
      password: decodeSecret(row.imapPassword)
    },
    smtp: {
      host: row.smtpHost,
      port: row.smtpPort,
      secure: Boolean(row.smtpSecure),
      user: row.smtpUser,
      password: decodeSecret(row.smtpPassword)
    },
    ownerUserId: row.ownerUserId ?? undefined
  };
}

function mergeAccount(current: Account, payload: Partial<Account>): Account {
  const mergedCaldav =
    payload.caldav !== undefined
      ? payload.caldav === null
        ? undefined
        : { ...(current.caldav ?? {}), ...payload.caldav }
      : current.caldav;
  return {
    ...current,
    ...payload,
    caldav: mergedCaldav,
    imap: { ...current.imap, ...(payload.imap ?? {}) },
    smtp: { ...current.smtp, ...(payload.smtp ?? {}) },
    settings: { ...(current.settings ?? {}), ...(payload.settings ?? {}) }
  } as Account;
}

function persistAccountRow(db: any, account: Account, dbPath?: string | null) {
  const settings = normalizeAccountSettings(account.settings);
  const insert = db.prepare(`
    INSERT OR REPLACE INTO accounts (
      id, name, email, avatar, ownerUserId, dbPath,
      settings,
      imapHost, imapPort, imapSecure, imapUser, imapPassword,
      smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword,
      caldavUrl, caldavUser, caldavPassword, caldavCalendarPath, caldavSyncIntervalMs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    account.id,
    account.name,
    account.email,
    account.avatar,
    account.ownerUserId ?? null,
    resolveAccountDbPathForPersist(account.id, dbPath),
    settings ? JSON.stringify(settings) : null,
    account.imap.host,
    account.imap.port,
    account.imap.secure ? 1 : 0,
    account.imap.user,
    shouldStorePasswordInDb() ? encodeSecret(account.imap.password) : "",
    account.smtp.host,
    account.smtp.port,
    account.smtp.secure ? 1 : 0,
    account.smtp.user,
    shouldStorePasswordInDb() ? encodeSecret(account.smtp.password) : "",
    account.caldav?.url ?? null,
    account.caldav?.user ?? null,
    account.caldav?.password ? encodeSecret(account.caldav.password) : null,
    account.caldav?.calendarPath ?? null,
    account.caldav?.syncIntervalMs ?? null
  );
}

export async function getAccounts() {
  const db = await getDb();
  const rows = db.prepare(`SELECT * FROM accounts`).all() as any[];
  return rows.map((row) => applyCachedCredentials(mapAccountRow(row))) as Account[];
}

export async function getAccountsForUser(userId: string) {
  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT a.*
       FROM accounts a
       LEFT JOIN user_accounts ua ON ua.accountId = a.id
       WHERE ua.userId = ? OR a.ownerUserId = ?
       ORDER BY a.id ASC`
    )
    .all(userId, userId) as any[];
  return rows.map((row) => applyCachedCredentials(mapAccountRow(row))) as Account[];
}

export async function saveAccounts(nextAccounts: Account[]) {
  return withDbWriteRetry("saveAccounts", async () => {
    const db = await getDb();
    const existingPaths = new Map<string, string | null>(
      (
        db.prepare(`SELECT id, dbPath FROM accounts`).all() as Array<{
          id: string;
          dbPath?: string | null;
        }>
      ).map((row) => [row.id, row.dbPath ?? null])
    );
    db.transaction(() => {
      db.exec(`DELETE FROM accounts`);
      nextAccounts.forEach((account) => {
        persistAccountRow(db, account, existingPaths.get(account.id));
      });
    })();
    const newAccountIds = nextAccounts
      .map((account) => account.id)
      .filter((accountId) => !existingPaths.has(accountId));
    await Promise.all(newAccountIds.map((accountId) => getCategoryLinearModel(accountId)));
  });
}

export async function getAccountById(accountId: string) {
  const db = await getDb();
  const row = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(accountId) as any;
  if (!row) return null;
  return applyCachedCredentials(mapAccountRow(row));
}

export async function upsertAccount(account: Account) {
  return withDbWriteRetry("upsertAccount", async () => {
    const db = await getDb();
    const existing = db
      .prepare(`SELECT dbPath FROM accounts WHERE id = ?`)
      .get(account.id) as { dbPath?: string | null } | undefined;
    db.transaction(() => {
      persistAccountRow(db, account, existing?.dbPath ?? null);
    })();
    if (!existing) {
      await getCategoryLinearModel(account.id);
    }
    return applyCachedCredentials(account);
  });
}

export async function patchAccount(accountId: string, payload: Partial<Account>) {
  return withDbWriteRetry("patchAccount", async () => {
    const db = await getDb();
    const row = db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(accountId) as any;
    if (!row) return null;
    const current = mapAccountRow(row);
    const next = mergeAccount(current, payload);
    db.transaction(() => {
      persistAccountRow(db, next, row.dbPath ?? null);
    })();
    return applyCachedCredentials(next);
  });
}

export async function deleteAccountControlPlane(accountId: string) {
  return withDbWriteRetry("deleteAccountControlPlane", async () => {
    const db = await getDb();
    const row = db
      .prepare(`SELECT id, dbPath FROM accounts WHERE id = ?`)
      .get(accountId) as { id?: string; dbPath?: string | null } | undefined;
    if (!row?.id) return false;

    const dbPath = resolveAccountDbPathForPersist(accountId, row.dbPath ?? null);
    const sharedPathRow = db
      .prepare(`SELECT COUNT(*) as count FROM accounts WHERE id <> ? AND dbPath = ?`)
      .get(accountId, dbPath) as { count: number } | undefined;
    const mainDbPath = path.resolve(getMainDbPath());
    const deleteShardFile =
      (sharedPathRow?.count ?? 0) === 0 && path.resolve(dbPath) !== mainDbPath;

    closeAccountDbConnection(dbPath);

    db.transaction(() => {
      db.prepare(`DELETE FROM user_accounts WHERE accountId = ?`).run(accountId);
      db.prepare(`DELETE FROM accounts WHERE id = ?`).run(accountId);
    })();

    await cleanupAccountLifecycleArtifacts(accountId, dbPath, deleteShardFile);
    return true;
  });
}

// Users
export async function getUsers() {
  const db = await getDb();
  const rows = db.prepare(`SELECT * FROM users`).all() as any[];
  return rows.map(mapUserRow);
}

export async function getUserById(userId: string) {
  const db = await getDb();
  const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as any;
  if (!row) return null;
  return mapUserRow(row);
}

export async function saveUsers(users: User[]) {
  return withDbWriteRetry("saveUsers", async () => {
    const db = await getDb();
    const insert = db.prepare(
      `INSERT OR REPLACE INTO users (id, email, role, createdAt) VALUES (?, ?, ?, ?)`
    );
    db.transaction(() => {
      db.exec(`DELETE FROM users`);
      users.forEach((u) => insert.run(u.id, u.email, u.role, u.createdAt));
    })();
  });
}

export async function getUserAccounts() {
  const db = await getDb();
  const rows = db.prepare(`SELECT * FROM user_accounts`).all() as any[];
  return rows as { userId: string; accountId: string }[];
}

export async function listAccessibleAccountIdsForUser(userId: string) {
  const db = await getDb();
  const rows = db
    .prepare(
      `SELECT DISTINCT a.id as id
       FROM accounts a
       LEFT JOIN user_accounts ua ON ua.accountId = a.id
       WHERE ua.userId = ? OR a.ownerUserId = ?
       ORDER BY a.id ASC`
    )
    .all(userId, userId) as Array<{ id?: string | null }>;
  return rows
    .map((row) => String(row.id ?? "").trim())
    .filter(Boolean);
}

export async function saveUserAccounts(items: { userId: string; accountId: string }[]) {
  return withDbWriteRetry("saveUserAccounts", async () => {
    const db = await getDb();
    const insert = db.prepare(
      `INSERT OR REPLACE INTO user_accounts (userId, accountId) VALUES (?, ?)`
    );
    db.transaction(() => {
      db.exec(`DELETE FROM user_accounts`);
      items.forEach((it) => insert.run(it.userId, it.accountId));
    })();
  });
}

export async function addUserAccountLink(userId: string, accountId: string) {
  return withDbWriteRetry("addUserAccountLink", async () => {
    const db = await getDb();
    db.prepare(`INSERT OR REPLACE INTO user_accounts (userId, accountId) VALUES (?, ?)`).run(
      userId,
      accountId
    );
  });
}

export async function getInviteCodes() {
  const db = await getDb();
  const rows = db.prepare(`SELECT * FROM invite_codes`).all() as any[];
  return rows.map(mapInviteRow);
}

export async function createInviteCode(options?: {
  role?: InviteCode["role"];
  maxUses?: number | null;
  expiresAt?: number | null;
}) {
  return withDbWriteRetry("createInviteCode", async () => {
    const db = await getDb();
    const maxUses =
      options?.maxUses === undefined
        ? 1
        : options.maxUses === null
          ? null
          : Math.max(1, Math.floor(options.maxUses));
    const expiresAt =
      typeof options?.expiresAt === "number" && Number.isFinite(options.expiresAt)
        ? Math.floor(options.expiresAt)
        : null;
    const invite: InviteCode = {
      code: randomUUID(),
      role: options?.role === "admin" ? "admin" : "user",
      maxUses,
      uses: 0,
      expiresAt,
      createdAt: Date.now(),
      usedByUserId: null
    };
    db.prepare(
      `INSERT INTO invite_codes (code, role, maxUses, uses, expiresAt, createdAt, usedByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      invite.code,
      invite.role,
      invite.maxUses,
      invite.uses,
      invite.expiresAt,
      invite.createdAt,
      invite.usedByUserId
    );
    return invite;
  });
}

export async function saveInviteCodes(items: InviteCode[]) {
  return withDbWriteRetry("saveInviteCodes", async () => {
    const db = await getDb();
    const insert = db.prepare(
      `INSERT OR REPLACE INTO invite_codes
       (code, role, maxUses, uses, expiresAt, createdAt, usedByUserId)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    db.transaction(() => {
      db.exec(`DELETE FROM invite_codes`);
      items.forEach((it) =>
        insert.run(
          it.code,
          it.role,
          it.maxUses,
          it.uses,
          it.expiresAt,
          Number.isFinite(it.createdAt) ? Math.floor(it.createdAt) : 0,
          it.usedByUserId ?? null
        )
      );
    })();
  });
}

async function listAccountIdsFromMaster() {
  const db = await getDb();
  const rows = db.prepare(`SELECT id FROM accounts ORDER BY id ASC`).all() as Array<{ id: string }>;
  return rows.map((row) => row.id).filter(Boolean);
}

async function getAccountEmail(accountId: string) {
  const db = await getDb();
  const row = db
    .prepare(`SELECT email FROM accounts WHERE id = ?`)
    .get(accountId) as { email?: string | null } | undefined;
  return row?.email?.toLowerCase() ?? "";
}

async function getFoldersForAccount(accountId: string) {
  const db = await getAccountDb(accountId);
  const rows = db.prepare(`SELECT * FROM folders WHERE accountId = ?`).all(accountId) as any[];
  const counts = db
    .prepare(
      `SELECT folderId, COUNT(*) as count
       FROM messages
       WHERE accountId = ? AND unread = 1
       GROUP BY folderId`
    )
    .all(accountId) as any[];
  const totals = db
    .prepare(
      `SELECT folderId, COUNT(*) as count
       FROM messages
       WHERE accountId = ?
       GROUP BY folderId`
    )
    .all(accountId) as any[];
  const countMap = new Map<string, number>();
  counts.forEach((row) => {
    if (row.folderId) {
      countMap.set(row.folderId, row.count ?? 0);
    }
  });
  const totalMap = new Map<string, number>();
  totals.forEach((row) => {
    if (row.folderId) {
      totalMap.set(row.folderId, row.count ?? 0);
    }
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId ?? undefined,
    accountId: row.accountId,
    count: totalMap.get(row.id) ?? row.count ?? 0,
    specialUse: row.specialUse ?? undefined,
    flags: row.flags ? (JSON.parse(row.flags) as string[]) : undefined,
    delimiter: row.delimiter ?? undefined,
    unreadCount: countMap.get(row.id) ?? 0
  })) as Folder[];
}

export async function getFolders(accountId?: string) {
  if (accountId) {
    return getFoldersForAccount(accountId);
  }
  const accountIds = await listAccountIdsFromMaster();
  const folderSets = await Promise.all(accountIds.map((id) => getFoldersForAccount(id)));
  return folderSets.flat();
}

export async function saveFoldersForAccount(accountId: string, nextFolders: Folder[]) {
  return withDbWriteRetry("saveFoldersForAccount", async () => {
    const db = await getAccountDb(accountId);
    const insert = db.prepare(
      `INSERT OR REPLACE INTO folders (id, name, parentId, accountId, count, specialUse, flags, delimiter) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const deleteForAccount = db.prepare(`DELETE FROM folders WHERE accountId = ?`);
    db.transaction(() => {
      deleteForAccount.run(accountId);
      nextFolders.forEach((folder) => {
        insert.run(
          folder.id,
          folder.name,
          folder.parentId ?? null,
          accountId,
          folder.count,
          folder.specialUse ?? null,
          folder.flags ? JSON.stringify(folder.flags) : null,
          folder.delimiter ?? null
        );
      });
    })();
  });
}

async function recomputeThreadsForAccountInternal(accountId: string, threadIds?: string[]) {
  const db = await getAccountDb(accountId);
  const accountEmail = await getAccountEmail(accountId);
  const latestReceivedDateSql = buildThreadLatestReceivedDateSql("m", accountEmail);
  const latestReceivedDateArgs = getThreadLatestReceivedDateArgs(accountEmail);
  if (threadIds && threadIds.length > 0) {
    const unique = Array.from(new Set(threadIds.filter(Boolean)));
    if (unique.length === 0) return;
    const placeholders = unique.map(() => "?").join(", ");
    db.prepare(
      `DELETE FROM threads WHERE accountId = ? AND threadId IN (${placeholders})`
    ).run(accountId, ...unique);
    db.prepare(
      `
      INSERT OR REPLACE INTO threads (
        threadId,
        accountId,
        rootMessageId,
        latestMessageId,
        latestDateValue,
        latestReceivedDateValue,
        messageCount,
        unreadCount
      )
      SELECT
        m.threadId as threadId,
        m.accountId as accountId,
        (SELECT id FROM messages m2 WHERE m2.accountId = m.accountId AND m2.threadId = m.threadId ORDER BY m2.dateValue ASC LIMIT 1) as rootMessageId,
        (SELECT id FROM messages m3 WHERE m3.accountId = m.accountId AND m3.threadId = m.threadId ORDER BY m3.dateValue DESC LIMIT 1) as latestMessageId,
        MAX(m.dateValue) as latestDateValue,
        ${latestReceivedDateSql} as latestReceivedDateValue,
        COUNT(*) as messageCount,
        SUM(CASE WHEN m.unread = 1 THEN 1 ELSE 0 END) as unreadCount
      FROM messages m
      WHERE m.accountId = ? AND m.threadId IN (${placeholders})
      GROUP BY m.threadId, m.accountId
    `
    ).run(...latestReceivedDateArgs, accountId, ...unique);
    return;
  }
  db.prepare(`DELETE FROM threads WHERE accountId = ?`).run(accountId);
  db.prepare(
    `
    INSERT OR REPLACE INTO threads (
      threadId,
      accountId,
      rootMessageId,
      latestMessageId,
      latestDateValue,
      latestReceivedDateValue,
      messageCount,
      unreadCount
    )
    SELECT
      m.threadId as threadId,
      m.accountId as accountId,
      (SELECT id FROM messages m2 WHERE m2.accountId = m.accountId AND m2.threadId = m.threadId ORDER BY m2.dateValue ASC LIMIT 1) as rootMessageId,
      (SELECT id FROM messages m3 WHERE m3.accountId = m.accountId AND m3.threadId = m.threadId ORDER BY m3.dateValue DESC LIMIT 1) as latestMessageId,
      MAX(m.dateValue) as latestDateValue,
      ${latestReceivedDateSql} as latestReceivedDateValue,
      COUNT(*) as messageCount,
      SUM(CASE WHEN m.unread = 1 THEN 1 ELSE 0 END) as unreadCount
    FROM messages m
    WHERE m.accountId = ?
    GROUP BY m.threadId, m.accountId
  `
  ).run(...latestReceivedDateArgs, accountId);
}

export async function recomputeThreadsForAccount(accountId: string, threadIds?: string[]) {
  return withDbWriteRetry("recomputeThreadsForAccount", async () => {
    await recomputeThreadsForAccountInternal(accountId, threadIds);
    const db = await getAccountDb(accountId);
    if (threadIds && threadIds.length > 0) {
      await rebuildThreadSignalsForThreadIds(db, accountId, threadIds);
      deleteTopicLearningSignals(db, accountId, { threadIds });
      upsertTopicLearningSignalsForThreadIds(db, accountId, threadIds);
      return;
    }
    await rebuildAllThreadSignalsForAccount(db, accountId);
    db.prepare(`DELETE FROM topic_learning_signals WHERE accountId = ?`).run(accountId);
    const threadRows = db
      .prepare(
        `SELECT DISTINCT threadId
         FROM thread_topics
         WHERE accountId = ?`
      )
      .all(accountId) as Array<{ threadId?: string | null }>;
    upsertTopicLearningSignalsForThreadIds(
      db,
      accountId,
      threadRows.map((row) => row.threadId ?? "")
    );
  });
}

async function ensureThreadLatestReceivedDateValues(
  db: any,
  accountId: string,
  threadIds?: string[]
) {
  const unique = Array.from(new Set((threadIds ?? []).filter(Boolean)));
  const hasMissingRows =
    unique.length > 0
      ? (db
          .prepare(
            `SELECT 1
             FROM threads
             WHERE accountId = ?
               AND threadId IN (${unique.map(() => "?").join(",")})
               AND latestReceivedDateValue IS NULL
             LIMIT 1`
          )
          .get(accountId, ...unique) as { 1?: number } | undefined)
      : (db
          .prepare(
            `SELECT 1
             FROM threads
             WHERE accountId = ? AND latestReceivedDateValue IS NULL
             LIMIT 1`
          )
          .get(accountId) as { 1?: number } | undefined);
  if (!hasMissingRows) return;

  const accountEmail = await getAccountEmail(accountId);
  const latestReceivedDateSql = buildThreadLatestReceivedDateSql("m", accountEmail);
  const latestReceivedDateArgs = getThreadLatestReceivedDateArgs(accountEmail);
  const threadFilterSql =
    unique.length > 0 ? `AND t.threadId IN (${unique.map(() => "?").join(",")})` : "";
  db.prepare(
    `
    UPDATE threads AS t
    SET latestReceivedDateValue = (
      SELECT ${latestReceivedDateSql}
      FROM messages m
      WHERE m.accountId = t.accountId
        AND m.threadId = t.threadId
    )
    WHERE t.accountId = ?
      ${threadFilterSql}
      AND t.latestReceivedDateValue IS NULL
  `
  ).run(...latestReceivedDateArgs, accountId, ...unique);
}

export async function recomputeThreadIdsForAccount(accountId: string) {
  return withDbWriteRetry("recomputeThreadIdsForAccount", async () => {
    const db = await getAccountDb(accountId);
    const rows = db
      .prepare(
        `SELECT id, messageId, inReplyTo, "references", threadId, parentId, dateValue
         FROM messages
         WHERE accountId = ?`
      )
      .all(accountId) as Array<{
      id: string;
      messageId: string | null;
      inReplyTo: string | null;
      references: string | null;
      threadId: string;
      parentId: string | null;
      dateValue: number;
    }>;
    if (rows.length === 0) return;
    const normalized = resolveThreadingForItems(
      rows.map((row) => ({
        id: row.id,
        dateValue: row.dateValue,
        messageId: row.messageId,
        inReplyTo: row.inReplyTo,
        references: parseReferences(row.references),
        threadId: row.threadId
      }))
    );
    const normalizedById = new Map(normalized.map((row) => [row.id, row]));
    const updates: Array<{ id: string; threadId: string; parentId: string | null }> = [];
    rows.forEach((row) => {
      const next = normalizedById.get(row.id);
      if (!next?.threadId) return;
      const nextParentId = next.parentId ?? null;
      const nextThreadId = next.threadId;
      if (
        (nextThreadId && nextThreadId !== row.threadId) ||
        (nextParentId ?? null) !== (row.parentId ?? null)
      ) {
        updates.push({ id: row.id, threadId: nextThreadId, parentId: nextParentId });
      }
    });
    if (updates.length === 0) return;
    const update = db.prepare(`UPDATE messages SET threadId = ?, parentId = ? WHERE id = ?`);
    db.transaction(() => {
      updates.forEach((row) => update.run(row.threadId, row.parentId, row.id));
    })();
    await rebuildAllThreadSignalsForAccount(db, accountId);
  });
}

export async function getMailboxState(accountId: string, folderId: string) {
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(
      `SELECT accountId, folderId, mailboxPath, uidValidity, highestModSeq, highestUid, supportsQresync FROM mailbox_state WHERE accountId = ? AND folderId = ?`
    )
    .get(accountId, folderId) as
    | {
        accountId: string;
        folderId: string;
        mailboxPath: string;
        uidValidity: string | null;
        highestModSeq: string | null;
        highestUid: number | null;
        supportsQresync: number | null;
      }
    | undefined;
  if (!row) return null;
  return {
    accountId: row.accountId,
    folderId: row.folderId,
    mailboxPath: row.mailboxPath,
    uidValidity: row.uidValidity,
    highestModSeq: row.highestModSeq,
    highestUid: row.highestUid,
    supportsQresync: row.supportsQresync === null ? null : Boolean(row.supportsQresync)
  };
}

export async function saveMailboxState(state: MailboxState) {
  return withDbWriteRetry("saveMailboxState", async () => {
    const db = await getAccountDb(state.accountId);
    const insert = db.prepare(`
      INSERT OR REPLACE INTO mailbox_state
      (folderId, accountId, mailboxPath, uidValidity, highestModSeq, highestUid, supportsQresync)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      state.folderId,
      state.accountId,
      state.mailboxPath,
      state.uidValidity ?? null,
      state.highestModSeq ?? null,
      state.highestUid ?? null,
      state.supportsQresync == null ? null : state.supportsQresync ? 1 : 0
    );
  });
}

type UpsertCalendarReminderInput = {
  id?: string;
  messageId?: string;
  eventUid?: string;
  eventTitle?: string;
  eventLocation?: string;
  eventDescription?: string;
  startTimezone?: string;
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
  eventStartAtMs: number;
  eventEndAtMs?: number;
  leadMinutes: number;
  leadLabel: string;
};

type MatchingCalendarReminderRow = {
  id: string;
  createdAtMs: number;
  messageId?: string | null;
};

type CalendarReminderEventMatch = {
  eventUid?: string;
  eventTitle?: string;
  eventStartAtMs: number;
};

function normalizeReminderTimezone(value?: string) {
  const normalized = value?.trim();
  if (!normalized) return null;
  return resolveCalendarTimeZoneId(normalized) ?? normalized.replace(/^"|"$/g, "");
}

function normalizeReminderRecurrenceRule(value?: string) {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (normalized.toUpperCase().startsWith("RRULE:")) {
    const trimmed = normalized.slice(6).trim();
    return trimmed || null;
  }
  return normalized;
}

function parseReminderDateListJson(value: unknown): number[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    return normalizeReminderDateList(value);
  }
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    return normalizeReminderDateList(parsed);
  } catch {
    return undefined;
  }
}

function serializeReminderDateList(value?: number[]) {
  const normalized = normalizeReminderDateList(value);
  if (!normalized || normalized.length === 0) return null;
  return JSON.stringify(normalized);
}

function mapCalendarReminderRow(
  row: any,
  options?: { nowMs?: number; allowPastFallback?: boolean }
): CalendarReminder | null {
  const nowMs = options?.nowMs ?? Date.now();
  const eventStartAtMs = Number(row.eventStartAtMs ?? 0);
  const eventEndAtMsRaw = Number(row.eventEndAtMs ?? 0);
  const eventEndAtMs =
    Number.isFinite(eventEndAtMsRaw) && eventEndAtMsRaw > 0 ? eventEndAtMsRaw : undefined;
  const leadMinutes = Math.max(0, Number(row.leadMinutes ?? 0));
  const recurrenceRule = normalizeReminderRecurrenceRule(
    typeof row.recurrenceRule === "string" ? row.recurrenceRule : undefined
  );
  const recurrenceDates = parseReminderDateListJson(row.recurrenceDates);
  const excludedDates = parseReminderDateListJson(row.excludedDates);
  const startTimezone = normalizeReminderTimezone(
    typeof row.startTimezone === "string" ? row.startTimezone : undefined
  );
  const nextOccurrence = resolveNextReminderOccurrence(
    {
      eventStartAtMs,
      eventEndAtMs,
      leadMinutes,
      recurrenceRule: recurrenceRule ?? undefined,
      recurrenceDates,
      excludedDates,
      startTimezone: startTimezone ?? undefined
    },
    nowMs
  );
  if (!nextOccurrence && !options?.allowPastFallback) return null;
  const fallbackTriggerAtMs = eventStartAtMs - leadMinutes * 60 * 1000;
  return {
    id: String(row.id),
    accountId: String(row.accountId),
    userId: String(row.userId),
    messageId: row.messageId ? String(row.messageId) : undefined,
    eventUid: row.eventUid ? String(row.eventUid) : undefined,
    eventTitle: String(row.eventTitle ?? "Calendar event"),
    eventLocation: row.eventLocation ? String(row.eventLocation) : undefined,
    eventDescription: row.eventDescription ? String(row.eventDescription) : undefined,
    startTimezone: startTimezone ?? undefined,
    recurrenceRule: recurrenceRule ?? undefined,
    recurrenceDates,
    excludedDates,
    eventStartAtMs,
    eventEndAtMs,
    nextEventStartAtMs: nextOccurrence?.eventStartAtMs ?? eventStartAtMs,
    leadMinutes,
    leadLabel: String(row.leadLabel ?? ""),
    triggerAtMs: nextOccurrence?.triggerAtMs ?? fallbackTriggerAtMs,
    createdAtMs: Number(row.createdAtMs ?? 0),
    updatedAtMs: Number(row.updatedAtMs ?? row.createdAtMs ?? 0)
  };
}

function normalizeReminderEventTitle(title?: string) {
  return (title ?? "Calendar event").trim() || "Calendar event";
}

function normalizeReminderEventUid(uid?: string) {
  const value = uid?.trim();
  return value ? value : null;
}

function normalizeReminderEventUidKey(uid?: string | null) {
  return normalizeCalendarEventUidKey(uid);
}

function backfillCalendarReminderEventUidKeys(db: any) {
  const rows = db
    .prepare(
      `SELECT id, eventUid
       FROM calendar_reminders
       WHERE COALESCE(eventUid, '') <> ''
         AND COALESCE(eventUidKey, '') = ''`
    )
    .all() as Array<{ id?: string | null; eventUid?: string | null }>;
  if (rows.length === 0) return;
  const updateStatement = db.prepare(
    `UPDATE calendar_reminders
     SET eventUidKey = ?
     WHERE id = ?`
  );
  const runUpdate = db.transaction((items: Array<{ id?: string | null; eventUid?: string | null }>) => {
    items.forEach((row) => {
      const reminderId = (row.id ?? "").trim();
      if (!reminderId) return;
      const eventUidKey = normalizeReminderEventUidKey(row.eventUid ?? undefined);
      if (!eventUidKey) return;
      updateStatement.run(eventUidKey, reminderId);
    });
  });
  runUpdate(rows);
}

export async function listCalendarReminders(accountId: string, userId: string) {
  const db = await getAccountDb(accountId);
  const nowMs = Date.now();
  const rows = db
    .prepare(
      `SELECT id, accountId, userId, messageId, eventUid, eventTitle, eventLocation, eventDescription, eventStartAtMs, eventEndAtMs, startTimezone, recurrenceRule, recurrenceDates, excludedDates, leadMinutes, leadLabel, createdAtMs, updatedAtMs
       FROM calendar_reminders
       WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL
       ORDER BY updatedAtMs DESC, createdAtMs DESC`
    )
    .all(accountId, userId) as any[];
  return rows
    .map((row) => mapCalendarReminderRow(row, { nowMs }))
    .filter((item): item is CalendarReminder => Boolean(item))
    .sort((a, b) => a.triggerAtMs - b.triggerAtMs);
}

export async function listDeleteCalendarAssociations(
  accountId: string,
  userId: string,
  messageIds: string[],
  eventUids: string[]
) {
  const uniqueMessageIds = Array.from(
    new Set(messageIds.map((value) => value.trim()).filter((value): value is string => Boolean(value)))
  );
  const uniqueEventUidKeys = Array.from(
    new Set(
      eventUids
        .map((value) => normalizeReminderEventUidKey(value))
        .filter((value): value is string => Boolean(value))
    )
  );
  if (uniqueMessageIds.length === 0 && uniqueEventUidKeys.length === 0) {
    return { reminders: [], events: [] };
  }

  const db = await getAccountDb(accountId);
  const reminderClauses: string[] = [];
  const reminderArgs: Array<string> = [accountId, userId];

  if (uniqueMessageIds.length > 0) {
    const placeholders = uniqueMessageIds.map(() => "?").join(", ");
    reminderClauses.push(`messageId IN (${placeholders})`);
    reminderArgs.push(...uniqueMessageIds);
  }

  if (uniqueEventUidKeys.length > 0) {
    const placeholders = uniqueEventUidKeys.map(() => "?").join(", ");
    reminderClauses.push(`lower(COALESCE(eventUidKey, eventUid, '')) IN (${placeholders})`);
    reminderArgs.push(...uniqueEventUidKeys);
  }

  const reminderRows =
    reminderClauses.length > 0
      ? (db
          .prepare(
            `SELECT id, messageId, eventUid
             FROM calendar_reminders
             WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL
               AND (${reminderClauses.join(" OR ")})`
          )
          .all(...reminderArgs) as Array<{
          id?: string | null;
          messageId?: string | null;
          eventUid?: string | null;
        }>)
      : [];

  const eventRows =
    uniqueMessageIds.length > 0 || uniqueEventUidKeys.length > 0
      ? (db
          .prepare(
            `SELECT DISTINCT ce.id, ce.eventUid
             FROM calendar_events ce
             WHERE ce.accountId = ? AND ce.deletedAtMs IS NULL
               AND (
                 ${
                   uniqueMessageIds.length > 0
                     ? `EXISTS (
                         SELECT 1
                         FROM message_calendar_events mce
                         WHERE mce.accountId = ce.accountId
                           AND mce.messageId IN (${uniqueMessageIds.map(() => "?").join(", ")})
                           AND lower(COALESCE(mce.eventUidKey, mce.eventUid, '')) = lower(COALESCE(ce.eventUid, ''))
                       )`
                     : "0"
                 }
                 ${
                   uniqueEventUidKeys.length > 0
                     ? `OR lower(COALESCE(ce.eventUid, '')) IN (${uniqueEventUidKeys
                         .map(() => "?")
                         .join(", ")})`
                     : ""
                 }
               )`
          )
          .all(accountId, ...uniqueMessageIds, ...uniqueEventUidKeys) as Array<{
          id?: string | null;
          eventUid?: string | null;
        }>)
      : [];

  return {
    reminders: reminderRows
      .map((row) => ({
        id: row.id?.trim() ?? "",
        messageId: row.messageId?.trim() || undefined,
        eventUid: row.eventUid?.trim() || undefined
      }))
      .filter((row) => Boolean(row.id)),
    events: eventRows
      .map((row) => ({
        id: row.id?.trim() ?? "",
        eventUid: row.eventUid?.trim() || undefined
      }))
      .filter((row) => Boolean(row.id))
  };
}

function findMatchingCalendarReminderRows(
  db: any,
  accountId: string,
  userId: string,
  input: {
    eventUid?: string | null;
    eventStartAtMs: number;
    eventTitle: string;
  }
) {
  const eventUidKey = normalizeReminderEventUidKey(input.eventUid);
  if (eventUidKey) {
    return db
      .prepare(
        `SELECT id, createdAtMs, messageId
         FROM calendar_reminders
         WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL
           AND (
             lower(COALESCE(eventUidKey, eventUid, '')) = lower(?)
             OR (
               eventStartAtMs = ?
               AND lower(eventTitle) = lower(?)
             )
           )
         ORDER BY createdAtMs ASC`
      )
      .all(
        accountId,
        userId,
        eventUidKey,
        input.eventStartAtMs,
        input.eventTitle
      ) as MatchingCalendarReminderRow[];
  }
  return db
    .prepare(
      `SELECT id, createdAtMs, messageId
       FROM calendar_reminders
       WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL
         AND eventStartAtMs = ?
         AND lower(eventTitle) = lower(?)
       ORDER BY createdAtMs ASC`
    )
    .all(accountId, userId, input.eventStartAtMs, input.eventTitle) as MatchingCalendarReminderRow[];
}

function upsertCalendarReminderWithDb(
  db: any,
  accountId: string,
  userId: string,
  input: UpsertCalendarReminderInput
) {
  const now = Date.now();
  const eventUid = normalizeReminderEventUid(input.eventUid);
  const eventUidKey = normalizeReminderEventUidKey(eventUid);
  const inputId = input.id?.trim() || null;
  const messageId =
    typeof input.messageId === "string" && input.messageId.trim()
      ? input.messageId.trim()
      : null;
  const eventTitle = normalizeReminderEventTitle(input.eventTitle);
  const eventLocation = input.eventLocation?.trim() || null;
  const eventDescription = input.eventDescription?.trim() || null;
  const eventStartAtMs = Number(input.eventStartAtMs);
  const eventEndAtMsRaw = Number(input.eventEndAtMs);
  const eventEndAtMs =
    Number.isFinite(eventEndAtMsRaw) && eventEndAtMsRaw > 0 ? Math.round(eventEndAtMsRaw) : null;
  const startTimezone = normalizeReminderTimezone(input.startTimezone);
  const recurrenceRule = normalizeReminderRecurrenceRule(input.recurrenceRule);
  const recurrenceDates = normalizeReminderDateList(input.recurrenceDates);
  const excludedDates = normalizeReminderDateList(input.excludedDates);
  const leadMinutes = Math.max(0, Number(input.leadMinutes));
  const leadLabel = String(input.leadLabel ?? "").trim();

  if (!Number.isFinite(eventStartAtMs) || eventStartAtMs <= 0) {
    throw new Error("Invalid eventStartAtMs");
  }
  if (input.eventEndAtMs !== undefined && eventEndAtMs === null) {
    throw new Error("Invalid eventEndAtMs");
  }
  if (!Number.isFinite(leadMinutes)) {
    throw new Error("Invalid leadMinutes");
  }
  if (!leadLabel) {
    throw new Error("Invalid leadLabel");
  }

  const matchingRows = findMatchingCalendarReminderRows(db, accountId, userId, {
    eventUid,
    eventStartAtMs,
    eventTitle
  });

  const primaryRow = matchingRows[0];
  if (primaryRow) {
    const nextMessageId = messageId ?? (primaryRow.messageId ? String(primaryRow.messageId) : null);
    db.prepare(
      `UPDATE calendar_reminders
       SET messageId = ?, eventUid = ?, eventUidKey = ?, eventTitle = ?, eventLocation = ?, eventDescription = ?, eventStartAtMs = ?, eventEndAtMs = ?, startTimezone = ?, recurrenceRule = ?, recurrenceDates = ?, excludedDates = ?, leadMinutes = ?, leadLabel = ?, updatedAtMs = ?, deletedAtMs = NULL
       WHERE id = ?`
    ).run(
      nextMessageId,
      eventUid,
      eventUidKey,
      eventTitle,
      eventLocation,
      eventDescription,
      eventStartAtMs,
      eventEndAtMs,
      startTimezone,
      recurrenceRule,
      serializeReminderDateList(recurrenceDates),
      serializeReminderDateList(excludedDates),
      leadMinutes,
      leadLabel,
      now,
      primaryRow.id
    );
    if (matchingRows.length > 1) {
      const duplicateIds = matchingRows.slice(1).map((row) => row.id);
      db.prepare(
        `UPDATE calendar_reminders
         SET deletedAtMs = ?
         WHERE id IN (${duplicateIds.map(() => "?").join(",")})`
      ).run(now, ...duplicateIds);
    }
    const row = db
      .prepare(
        `SELECT id, accountId, userId, messageId, eventUid, eventTitle, eventLocation, eventDescription, eventStartAtMs, eventEndAtMs, startTimezone, recurrenceRule, recurrenceDates, excludedDates, leadMinutes, leadLabel, createdAtMs, updatedAtMs
         FROM calendar_reminders
         WHERE id = ?`
      )
      .get(primaryRow.id) as any;
    return {
      reminder: mapCalendarReminderRow(row, { allowPastFallback: true })!,
      replaced: true
    };
  }

  const id = inputId ?? randomUUID();
  db.prepare(
    `INSERT INTO calendar_reminders (
       id, accountId, userId, messageId, eventUid, eventUidKey, eventTitle, eventLocation, eventDescription, eventStartAtMs, eventEndAtMs, startTimezone, recurrenceRule, recurrenceDates, excludedDates, leadMinutes, leadLabel, createdAtMs, updatedAtMs, deletedAtMs
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(
    id,
    accountId,
    userId,
    messageId,
    eventUid,
    eventUidKey,
    eventTitle,
    eventLocation,
    eventDescription,
    eventStartAtMs,
    eventEndAtMs,
    startTimezone,
    recurrenceRule,
    serializeReminderDateList(recurrenceDates),
    serializeReminderDateList(excludedDates),
    leadMinutes,
    leadLabel,
    now,
    now
  );
  const row = db
    .prepare(
      `SELECT id, accountId, userId, messageId, eventUid, eventTitle, eventLocation, eventDescription, eventStartAtMs, eventEndAtMs, startTimezone, recurrenceRule, recurrenceDates, excludedDates, leadMinutes, leadLabel, createdAtMs, updatedAtMs
       FROM calendar_reminders
       WHERE id = ?`
    )
    .get(id) as any;
  return {
    reminder: mapCalendarReminderRow(row, { allowPastFallback: true })!,
    replaced: false
  };
}

export async function upsertCalendarReminder(
  accountId: string,
  userId: string,
  input: UpsertCalendarReminderInput
) {
  return withDbWriteRetry("upsertCalendarReminder", async () => {
    const db = await getAccountDb(accountId);
    return upsertCalendarReminderWithDb(db, accountId, userId, input);
  });
}

export async function ensureCalendarReminder(
  accountId: string,
  userId: string,
  input: UpsertCalendarReminderInput
) {
  return withDbWriteRetry("ensureCalendarReminder", async () => {
    const db = await getAccountDb(accountId);
    const eventTitle = normalizeReminderEventTitle(input.eventTitle);
    const eventStartAtMs = Number(input.eventStartAtMs);
    if (!Number.isFinite(eventStartAtMs) || eventStartAtMs <= 0) {
      throw new Error("Invalid eventStartAtMs");
    }
    const matchingRows = findMatchingCalendarReminderRows(db, accountId, userId, {
      eventUid: normalizeReminderEventUid(input.eventUid),
      eventStartAtMs,
      eventTitle
    });
    const existing = matchingRows[0];
    if (!existing) {
      const created = upsertCalendarReminderWithDb(db, accountId, userId, input);
      return { reminder: created.reminder, created: true };
    }
    const row = db
      .prepare(
        `SELECT id, accountId, userId, messageId, eventUid, eventTitle, eventLocation, eventDescription, eventStartAtMs, eventEndAtMs, startTimezone, recurrenceRule, recurrenceDates, excludedDates, leadMinutes, leadLabel, createdAtMs, updatedAtMs
         FROM calendar_reminders
         WHERE id = ?`
      )
      .get(existing.id) as any;
    return {
      reminder: mapCalendarReminderRow(row, { allowPastFallback: true })!,
      created: false
    };
  });
}

type AutomaticCalendarReminderSourceMessage = {
  eventUid: string;
  eventUidKey: string;
  rowMessageId: string;
  messageId?: string | null;
  hasSource?: number | null;
  dateValue?: number | null;
};

export type AutomaticCalendarReminderCreationResult = {
  scannedEventUids: number;
  created: number;
  updated: number;
  skippedExistingUid: number;
  skippedCanceled: number;
  skippedNoSource: number;
  skippedNoInviteData: number;
  skippedNoFutureEvent: number;
};

const AUTO_REMINDER_EXCLUDED_TRASH_SPECIAL_USES = new Set(["\\trash"]);
const AUTO_REMINDER_EXCLUDED_SPAM_SPECIAL_USES = new Set(["\\junk", "\\spam"]);
const AUTO_REMINDER_EXCLUDED_ARCHIVE_SPECIAL_USES = new Set(["\\archive"]);
const AUTO_REMINDER_EXCLUDED_TRASH_KEYWORDS = [
  "trash",
  "deleted",
  "bin",
  "wastebasket",
  "papierkorb"
];
const AUTO_REMINDER_EXCLUDED_SPAM_KEYWORDS = ["junk", "spam", "bulk"];
const AUTO_REMINDER_EXCLUDED_ARCHIVE_KEYWORDS = ["archive", "archiv"];

function getAutomaticReminderExcludedFolderIds(db: any, accountId: string) {
  const folders = db
    .prepare(`SELECT id, name, specialUse FROM folders WHERE accountId = ?`)
    .all(accountId) as Array<{ id: string; name?: string | null; specialUse?: string | null }>;
  return folders
    .filter((folder) => {
      const special = (folder.specialUse ?? "").trim().toLowerCase();
      if (
        AUTO_REMINDER_EXCLUDED_TRASH_SPECIAL_USES.has(special) ||
        AUTO_REMINDER_EXCLUDED_SPAM_SPECIAL_USES.has(special) ||
        AUTO_REMINDER_EXCLUDED_ARCHIVE_SPECIAL_USES.has(special)
      ) {
        return true;
      }
      const name = (folder.name ?? "").trim().toLowerCase();
      const id = folder.id.toLowerCase();
      const matchesTrash = AUTO_REMINDER_EXCLUDED_TRASH_KEYWORDS.some(
        (keyword) => name.includes(keyword) || id.includes(keyword)
      );
      if (matchesTrash) return true;
      const matchesSpam = AUTO_REMINDER_EXCLUDED_SPAM_KEYWORDS.some(
        (keyword) => name.includes(keyword) || id.includes(keyword)
      );
      if (matchesSpam) return true;
      return AUTO_REMINDER_EXCLUDED_ARCHIVE_KEYWORDS.some(
        (keyword) => name.includes(keyword) || id.includes(keyword)
      );
    })
    .map((folder) => folder.id);
}

function listLatestCalendarReminderSourceMessages(
  db: any,
  accountId: string,
  excludedFolderIds: string[]
) {
  const filters: string[] = [
    "mce.accountId = ?",
    "COALESCE(m.deleted, 0) = 0",
    "COALESCE(mce.eventUid, '') <> ''"
  ];
  const args: any[] = [accountId];
  if (excludedFolderIds.length > 0) {
    filters.push(`m.folderId NOT IN (${excludedFolderIds.map(() => "?").join(",")})`);
    args.push(...excludedFolderIds);
  }
  const rows = db
    .prepare(
      `SELECT eventUid, rowMessageId, messageId, hasSource, dateValue
       FROM (
         SELECT lower(mce.eventUid) AS eventUid,
                m.id AS rowMessageId,
                m.messageId AS messageId,
                m.hasSource AS hasSource,
                m.dateValue AS dateValue,
                ROW_NUMBER() OVER (
                  PARTITION BY lower(mce.eventUid)
                  ORDER BY m.dateValue DESC, m.id DESC
                ) AS rankIndex
         FROM message_calendar_events mce
         JOIN messages m
           ON m.accountId = mce.accountId
          AND m.id = mce.messageId
         WHERE ${filters.join(" AND ")}
       ) ranked
       WHERE rankIndex = 1`
    )
    .all(...args) as AutomaticCalendarReminderSourceMessage[];
  const dedupedByEventUidKey = new Map<string, AutomaticCalendarReminderSourceMessage>();
  rows.forEach((row) => {
    const eventUid = normalizeCalendarEventUid(row.eventUid) ?? "";
    if (!eventUid || !row.rowMessageId) return;
    const eventUidKey = normalizeReminderEventUidKey(eventUid) ?? eventUid;
    const dateValue = Number(row.dateValue ?? 0);
    const nextRow: AutomaticCalendarReminderSourceMessage = {
      eventUid,
      eventUidKey,
      rowMessageId: row.rowMessageId,
      messageId: row.messageId ?? null,
      hasSource: row.hasSource ?? null,
      dateValue
    };
    const existing = dedupedByEventUidKey.get(eventUidKey);
    if (!existing) {
      dedupedByEventUidKey.set(eventUidKey, nextRow);
      return;
    }
    const existingDateValue = Number(existing.dateValue ?? 0);
    if (dateValue > existingDateValue) {
      dedupedByEventUidKey.set(eventUidKey, nextRow);
      return;
    }
    if (dateValue === existingDateValue && row.rowMessageId > existing.rowMessageId) {
      dedupedByEventUidKey.set(eventUidKey, nextRow);
    }
  });
  return Array.from(dedupedByEventUidKey.values());
}

function listExistingCalendarReminderUids(db: any, accountId: string, userId: string) {
  const rows = db
    .prepare(
      `SELECT lower(COALESCE(eventUidKey, eventUid)) AS eventUid
       FROM calendar_reminders
       WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL
         AND COALESCE(eventUidKey, eventUid, '') <> ''`
    )
    .all(accountId, userId) as Array<{ eventUid?: string | null }>;
  return new Set(
    rows
      .map((row) => normalizeReminderEventUidKey(row.eventUid))
      .filter((uid): uid is string => Boolean(uid))
  );
}

function hasFutureReminderOccurrence(
  mutation: Extract<CalendarReminderMutation, { kind: "update" }>,
  nowMs: number
) {
  const next = resolveNextReminderOccurrence(
    {
      eventStartAtMs: mutation.eventStartAtMs,
      leadMinutes: 0,
      startTimezone: mutation.startTimezone,
      recurrenceRule: mutation.recurrenceRule,
      recurrenceDates: mutation.recurrenceDates,
      excludedDates: mutation.excludedDates
    },
    nowMs
  );
  return Boolean(next && next.eventStartAtMs > nowMs);
}

async function collectCalendarReminderMutationsByEventUidFromSource(
  source: string,
  messageId?: string | null
) {
  const mutationsByUid = new Map<string, CalendarReminderMutation>();
  if (!source.trim()) return mutationsByUid;
  try {
    const parsed = await simpleParser(source);
    const parsedAttachments = (parsed.attachments ?? []) as Attachment[];
    parsedAttachments.forEach((attachment) => {
      if (!isCalendarAttachment(attachment)) return;
      const attachmentBuffer = getAttachmentContentBuffer(attachment);
      if (!attachmentBuffer) return;
      const calendarMutations = collectCalendarReminderMutationsFromCalendarInvite(
        attachmentBuffer.toString("utf8"),
        messageId
      );
      calendarMutations.forEach((mutation) => {
        const eventUidKey = normalizeReminderEventUidKey(mutation.eventUid);
        if (!eventUidKey) return;
        mutationsByUid.set(eventUidKey, mutation);
      });
    });
  } catch {
    return mutationsByUid;
  }
  return mutationsByUid;
}

async function collectInviteDeckGroupsByEventUidKeyFromSource(
  source: string,
  nowMs: number
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!source.trim()) return result;
  try {
    const parsed = await simpleParser(source);
    const parsedAttachments = (parsed.attachments ?? []) as Attachment[];
    parsedAttachments.forEach((attachment) => {
      if (!isCalendarAttachment(attachment)) return;
      const attachmentBuffer = getAttachmentContentBuffer(attachment);
      if (!attachmentBuffer) return;
      const groups = collectCalendarInviteMutationGroups(attachmentBuffer.toString("utf8"));
      groups.forEach((group) => {
        const eventUidKey = normalizeReminderEventUidKey(group.eventUid);
        if (!eventUidKey) return;
        if (result.get(eventUidKey) === "UPCOMING") return;
        const bounds = deriveInviteDeckEventBounds(group);
        const nextGroup = buildInviteDeckGroupKeyFromBounds(bounds, nowMs);
        if (nextGroup === null) return;
        if (nextGroup === "UPCOMING" || !result.has(eventUidKey)) {
          result.set(eventUidKey, nextGroup);
        }
      });
    });
  } catch {
    return result;
  }
  return result;
}

export async function autoCreateCalendarRemindersFromInvites(
  accountId: string,
  userId: string,
  input: { leadMinutes: number; leadLabel: string }
): Promise<AutomaticCalendarReminderCreationResult> {
  const leadMinutes = Number(input.leadMinutes);
  const leadLabel = String(input.leadLabel ?? "").trim();
  if (!Number.isFinite(leadMinutes) || leadMinutes < 0) {
    throw new Error("Invalid leadMinutes");
  }
  if (!leadLabel) {
    throw new Error("Invalid leadLabel");
  }
  const nowMs = Date.now();
  const db = await getAccountDb(accountId);
  const excludedFolderIds = getAutomaticReminderExcludedFolderIds(db, accountId);
  const latestRows = listLatestCalendarReminderSourceMessages(db, accountId, excludedFolderIds);
  const result: AutomaticCalendarReminderCreationResult = {
    scannedEventUids: latestRows.length,
    created: 0,
    updated: 0,
    skippedExistingUid: 0,
    skippedCanceled: 0,
    skippedNoSource: 0,
    skippedNoInviteData: 0,
    skippedNoFutureEvent: 0
  };
  if (latestRows.length === 0) {
    return result;
  }

  const { getMessageSource } = await import("./storage");
  const mutationCacheByRowMessageId = new Map<string, Map<string, CalendarReminderMutation>>();
  const upsertInputs: UpsertCalendarReminderInput[] = [];
  const existingReminderUids = listExistingCalendarReminderUids(db, accountId, userId);

  for (const row of latestRows) {
    if (!row.hasSource) {
      result.skippedNoSource += 1;
      continue;
    }
    let mutationsForMessage = mutationCacheByRowMessageId.get(row.rowMessageId);
    if (!mutationsForMessage) {
      const source = await getMessageSource(accountId, row.rowMessageId);
      if (!source) {
        result.skippedNoSource += 1;
        continue;
      }
      mutationsForMessage = await collectCalendarReminderMutationsByEventUidFromSource(
        source,
        row.messageId
      );
      mutationCacheByRowMessageId.set(row.rowMessageId, mutationsForMessage);
    }
    const mutation = mutationsForMessage.get(row.eventUidKey);
    if (!mutation) {
      result.skippedNoInviteData += 1;
      continue;
    }
    if (mutation.kind === "cancel") {
      result.skippedCanceled += 1;
      continue;
    }
    if (!hasFutureReminderOccurrence(mutation, nowMs)) {
      result.skippedNoFutureEvent += 1;
      continue;
    }
    const mutationUidKey = normalizeReminderEventUidKey(mutation.eventUid);
    if (!mutationUidKey) {
      result.skippedNoInviteData += 1;
      continue;
    }
    if (existingReminderUids.has(mutationUidKey)) {
      result.skippedExistingUid += 1;
      continue;
    }
    upsertInputs.push({
      messageId: row.messageId ?? undefined,
      eventUid: mutation.eventUid,
      eventTitle: mutation.eventTitle,
      eventLocation: mutation.eventLocation,
      eventDescription: mutation.eventDescription,
      startTimezone: mutation.startTimezone,
      recurrenceRule: mutation.recurrenceRule,
      recurrenceDates: mutation.recurrenceDates,
      excludedDates: mutation.excludedDates,
      eventStartAtMs: mutation.eventStartAtMs,
      eventEndAtMs: mutation.eventEndAtMs,
      leadMinutes,
      leadLabel
    });
    existingReminderUids.add(mutationUidKey);
  }

  if (upsertInputs.length === 0) {
    return result;
  }

  const writeSummary = await withDbWriteRetry("autoCreateCalendarRemindersFromInvites", async () => {
    const writableDb = await getAccountDb(accountId);
    let created = 0;
    let updated = 0;
    const applyBatch = writableDb.transaction((batch: UpsertCalendarReminderInput[]) => {
      batch.forEach((item) => {
        const upserted = upsertCalendarReminderWithDb(writableDb, accountId, userId, item);
        if (upserted.replaced) {
          updated += 1;
        } else {
          created += 1;
        }
      });
    });
    applyBatch(upsertInputs);
    return { created, updated };
  });
  result.created = writeSummary.created;
  result.updated = writeSummary.updated;

  return result;
}

export async function deleteCalendarReminderById(accountId: string, userId: string, reminderId: string) {
  return withDbWriteRetry("deleteCalendarReminderById", async () => {
    const db = await getAccountDb(accountId);
    const result = db
      .prepare(
        `UPDATE calendar_reminders
         SET deletedAtMs = ?
         WHERE id = ? AND accountId = ? AND userId = ? AND deletedAtMs IS NULL`
      )
      .run(Date.now(), reminderId, accountId, userId) as { changes?: number };
    return (result?.changes ?? 0) > 0;
  });
}

export async function deleteCalendarReminderByEvent(
  accountId: string,
  userId: string,
  event: CalendarReminderEventMatch
) {
  return withDbWriteRetry("deleteCalendarReminderByEvent", async () => {
    const db = await getAccountDb(accountId);
    const now = Date.now();
    const eventUid = normalizeReminderEventUid(event.eventUid);
    const eventTitle = normalizeReminderEventTitle(event.eventTitle);
    const eventStartAtMs = Number(event.eventStartAtMs);
    if (!Number.isFinite(eventStartAtMs) || eventStartAtMs <= 0) {
      throw new Error("Invalid eventStartAtMs");
    }

    const result = eventUid
      ? (db
          .prepare(
            `UPDATE calendar_reminders
             SET deletedAtMs = ?
             WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL
               AND (
                 lower(COALESCE(eventUidKey, eventUid, '')) = lower(?)
                 OR (
                   eventStartAtMs = ?
                   AND lower(eventTitle) = lower(?)
                 )
               )`
          )
          .run(
            now,
            accountId,
            userId,
            normalizeReminderEventUidKey(eventUid),
            eventStartAtMs,
            eventTitle
          ) as { changes?: number })
      : (db
          .prepare(
            `UPDATE calendar_reminders
             SET deletedAtMs = ?
             WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL
               AND eventStartAtMs = ?
               AND lower(eventTitle) = lower(?)`
          )
          .run(now, accountId, userId, eventStartAtMs, eventTitle) as { changes?: number });

    return (result?.changes ?? 0) > 0;
  });
}

export async function clearCalendarReminders(accountId: string, userId: string) {
  return withDbWriteRetry("clearCalendarReminders", async () => {
    const db = await getAccountDb(accountId);
    const now = Date.now();
    const result = db
      .prepare(
        `UPDATE calendar_reminders
         SET deletedAtMs = ?, updatedAtMs = ?
         WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL`
      )
      .run(now, now, accountId, userId) as { changes?: number };
    return result?.changes ?? 0;
  });
}

type CalendarReminderRescheduleByUidInput = {
  eventTitle?: string;
  eventLocation?: string;
  eventDescription?: string;
  startTimezone?: string;
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
  eventStartAtMs: number;
  eventEndAtMs?: number;
  messageId?: string;
};

export async function rescheduleCalendarRemindersByEventUid(
  accountId: string,
  eventUid: string,
  input: CalendarReminderRescheduleByUidInput
) {
  return withDbWriteRetry("rescheduleCalendarRemindersByEventUid", async () => {
    const db = await getAccountDb(accountId);
    const normalizedUid = eventUid.trim();
    const normalizedUidKey = normalizeReminderEventUidKey(normalizedUid);
    if (!normalizedUid || !normalizedUidKey) return 0;
    const eventStartAtMs = Number(input.eventStartAtMs);
    if (!Number.isFinite(eventStartAtMs) || eventStartAtMs <= 0) return 0;
    const eventEndAtMsRaw = Number(input.eventEndAtMs);
    const eventEndAtMs =
      Number.isFinite(eventEndAtMsRaw) && eventEndAtMsRaw > 0 ? Math.round(eventEndAtMsRaw) : null;
    if (input.eventEndAtMs !== undefined && eventEndAtMs === null) return 0;
    const eventTitle = normalizeReminderEventTitle(input.eventTitle);
    const eventLocation = input.eventLocation?.trim() || null;
    const eventDescription = input.eventDescription?.trim() || null;
    const startTimezone = normalizeReminderTimezone(input.startTimezone);
    const recurrenceRule = normalizeReminderRecurrenceRule(input.recurrenceRule);
    const recurrenceDates = normalizeReminderDateList(input.recurrenceDates);
    const excludedDates = normalizeReminderDateList(input.excludedDates);
    const messageId =
      typeof input.messageId === "string" && input.messageId.trim()
        ? input.messageId.trim()
        : null;
    const now = Date.now();
    const result = db
      .prepare(
        `UPDATE calendar_reminders
         SET eventTitle = ?,
             eventLocation = ?,
             eventDescription = ?,
             eventUidKey = ?,
             eventStartAtMs = ?,
             eventEndAtMs = ?,
             startTimezone = ?,
             recurrenceRule = ?,
             recurrenceDates = ?,
             excludedDates = ?,
             updatedAtMs = ?,
             messageId = COALESCE(?, messageId)
         WHERE accountId = ? AND deletedAtMs IS NULL
           AND lower(COALESCE(eventUidKey, eventUid, '')) = lower(?)`
      )
      .run(
        eventTitle,
        eventLocation,
        eventDescription,
        normalizedUidKey,
        eventStartAtMs,
        eventEndAtMs,
        startTimezone,
        recurrenceRule,
        serializeReminderDateList(recurrenceDates),
        serializeReminderDateList(excludedDates),
        now,
        messageId,
        accountId,
        normalizedUidKey
      ) as { changes?: number };
    return result?.changes ?? 0;
  });
}

export async function cancelCalendarRemindersByEventUid(accountId: string, eventUid: string) {
  return withDbWriteRetry("cancelCalendarRemindersByEventUid", async () => {
    const db = await getAccountDb(accountId);
    const normalizedUid = eventUid.trim();
    const normalizedUidKey = normalizeReminderEventUidKey(normalizedUid);
    if (!normalizedUid || !normalizedUidKey) return 0;
    const now = Date.now();
    const result = db
      .prepare(
        `UPDATE calendar_reminders
         SET deletedAtMs = ?, updatedAtMs = ?
         WHERE accountId = ? AND deletedAtMs IS NULL
           AND lower(COALESCE(eventUidKey, eventUid, '')) = lower(?)`
      )
      .run(now, now, accountId, normalizedUidKey) as { changes?: number };
    return result?.changes ?? 0;
  });
}

function buildGroupKey(message: Message, groupBy: string, dateValueOverride?: number) {
  return buildMessageGroupKey(message, groupBy, dateValueOverride);
}

function buildGroupLabel(key: string, groupBy: string) {
  if (groupBy === "none") return "All";
  return key;
}

type InviteDeckEventRow = {
  messageId?: string | null;
  eventUid?: string | null;
  eventFirstStartAtMs?: number | null;
  eventLastEndAtMs?: number | null;
  startAtMs?: number | null;
  endAtMs?: number | null;
  startTimezone?: string | null;
  recurrenceRule?: string | null;
  recurrenceDates?: string | null;
  excludedDates?: string | null;
};

function getInviteDeckGroupKeyForStoredBoundsRow(row: InviteDeckEventRow, nowMs = Date.now()) {
  return buildInviteDeckGroupKeyFromBounds(
    {
      eventFirstStartAtMs: Number(row.eventFirstStartAtMs ?? 0) || undefined,
      eventLastEndAtMs:
        row.eventLastEndAtMs === null || row.eventLastEndAtMs === undefined
          ? row.eventFirstStartAtMs
            ? null
            : undefined
          : Number(row.eventLastEndAtMs)
    },
    nowMs
  );
}

function getInviteDeckGroupKeyForEventRow(row: InviteDeckEventRow, nowMs = Date.now()) {
  return buildInviteDeckGroupKeyFromEvent(
    {
      eventStartAtMs: Number(row.startAtMs ?? 0),
      eventEndAtMs: Number(row.endAtMs ?? 0) || undefined,
      startTimezone: normalizeReminderTimezone(
        typeof row.startTimezone === "string" ? row.startTimezone : undefined
      ) ?? undefined,
      recurrenceRule:
        normalizeReminderRecurrenceRule(
          typeof row.recurrenceRule === "string" ? row.recurrenceRule : undefined
        ) ?? undefined,
      recurrenceDates: parseReminderDateListJson(row.recurrenceDates),
      excludedDates: parseReminderDateListJson(row.excludedDates)
    },
    nowMs
  );
}

async function getInviteDeckGroupKeysByMessageId(
  db: any,
  accountId: string,
  messageIds: string[],
  nowMs = Date.now()
) {
  const uniqueMessageIds = Array.from(new Set(messageIds.map((value) => value.trim()).filter(Boolean)));
  if (uniqueMessageIds.length === 0) {
    return new Map<string, string>();
  }
  const rows = db
    .prepare(
      `
      SELECT
        mce.messageId AS messageId,
        mce.eventUid AS eventUid,
        mce.eventFirstStartAtMs AS eventFirstStartAtMs,
        mce.eventLastEndAtMs AS eventLastEndAtMs,
        ce.startAtMs AS startAtMs,
        ce.endAtMs AS endAtMs,
        ce.startTimezone AS startTimezone,
        ce.recurrenceRule AS recurrenceRule,
        ce.recurrenceDates AS recurrenceDates,
        ce.excludedDates AS excludedDates
      FROM message_calendar_events mce
      LEFT JOIN calendar_events ce
        ON ce.accountId = mce.accountId
       AND lower(ce.eventUid) = lower(mce.eventUid)
      WHERE mce.accountId = ?
        AND mce.messageId IN (${uniqueMessageIds.map(() => "?").join(",")})
        AND ce.deletedAtMs IS NULL
        AND (ce.sourceType = 'email' OR ce.eventUid IS NULL)
      `
    )
    .all(accountId, ...uniqueMessageIds) as InviteDeckEventRow[];

  const groupsByMessageId = new Map<string, string>();
  const missingEventUidsByMessageId = new Map<string, Set<string>>();
  rows.forEach((row) => {
    const messageId = String(row.messageId ?? "").trim();
    if (!messageId) return;
    const eventUidKey = normalizeReminderEventUidKey(row.eventUid ?? undefined);
    const storedGroup = getInviteDeckGroupKeyForStoredBoundsRow(row, nowMs);
    if (storedGroup) {
      const existing = groupsByMessageId.get(messageId);
      if (existing === "UPCOMING" || storedGroup === "UPCOMING") {
        groupsByMessageId.set(messageId, "UPCOMING");
        return;
      }
      groupsByMessageId.set(messageId, storedGroup);
      return;
    }
    if (!row.startAtMs) {
      if (eventUidKey) {
        const existing = missingEventUidsByMessageId.get(messageId) ?? new Set<string>();
        existing.add(eventUidKey);
        missingEventUidsByMessageId.set(messageId, existing);
      }
      return;
    }
    const nextGroup = getInviteDeckGroupKeyForEventRow(row, nowMs);
    const existing = groupsByMessageId.get(messageId);
    if (existing === "UPCOMING" || nextGroup === "UPCOMING") {
      groupsByMessageId.set(messageId, "UPCOMING");
      return;
    }
    groupsByMessageId.set(messageId, nextGroup);
  });

  for (const [messageId, missingEventUids] of missingEventUidsByMessageId.entries()) {
    if (groupsByMessageId.get(messageId) === "UPCOMING") continue;
    const source = await getMessageSource(accountId, messageId);
    if (!source) continue;
    const groupsByEventUidKey = await collectInviteDeckGroupsByEventUidKeyFromSource(source, nowMs);
    let fallbackGroup: string | null = null;
    missingEventUids.forEach((eventUidKey) => {
      const nextGroup = groupsByEventUidKey.get(eventUidKey);
      if (!nextGroup) return;
      if (nextGroup === "UPCOMING") {
        fallbackGroup = "UPCOMING";
        return;
      }
      fallbackGroup = fallbackGroup ?? nextGroup;
    });
    if (fallbackGroup) {
      groupsByMessageId.set(messageId, fallbackGroup);
    }
  }

  return groupsByMessageId;
}

async function getInviteDeckGroupSummary(params: {
  db: any;
  accountId: string;
  where: string;
  args: any[];
  nowMs?: number;
}) {
  const { db, accountId, where, args, nowMs = Date.now() } = params;
  const rows = db
    .prepare(
      `
      SELECT m.id AS id, m.dateValue AS dateValue
      FROM messages m
      WHERE ${where}
    `
    )
    .all(...args) as Array<{ id?: string | null; dateValue?: number | null }>;

  const normalizedRows = rows
    .map((row) => ({
      id: String(row.id ?? "").trim(),
      dateValue: Number(row.dateValue ?? 0)
    }))
    .filter((row) => row.id);

  const groupsByMessageId = await getInviteDeckGroupKeysByMessageId(
    db,
    accountId,
    normalizedRows.map((row) => row.id),
    nowMs
  );
  const counts = normalizedRows.reduce((acc, row) => {
    const key =
      groupsByMessageId.get(row.id) ??
      buildTimeGroupKey(row.dateValue, INVITE_DECK_GROUP_BY, nowMs);
    acc.set(key, (acc.get(key) ?? 0) + 1);
    return acc;
  }, new Map<string, number>());
  const groupRows = Array.from(counts.entries()).map(([key, count]) => ({ key, count }));

  return {
    groups: groupsFromRows(
      sortGroupsForGroupBy(groupRows, INVITE_DECK_GROUP_BY),
      INVITE_DECK_GROUP_BY
    ),
    groupsByMessageId,
    total: normalizedRows.length
  };
}

function buildSearchTokens(raw?: string | null) {
  if (!raw) return [];
  return raw
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const normalized = token.replace(/^"+|"+$/g, "");
      if (!normalized) return null;
      if (!/[\p{L}\p{N}]/u.test(normalized)) return null;
      return normalized;
    })
    .filter((token): token is string => Boolean(token));
}

function buildFtsTokenQuery(token: string) {
  const escaped = token.replace(/"/g, '""');
  if (/^[\p{L}\p{N}]+$/u.test(token)) return `${escaped}*`;
  if (/[\p{L}\p{N}]/u.test(token)) return `"${escaped}"*`;
  return null;
}

function buildScopedFtsTokenQueries(tokens: string[], columns: string[]) {
  if (columns.length === 0 || tokens.length === 0) return [];
  return tokens
    .map((token) => {
      const ftsToken = buildFtsTokenQuery(token);
      if (!ftsToken) return null;
      const orParts = columns.map((col) => `${col}:${ftsToken}`);
      return orParts.length > 1 ? `(${orParts.join(" OR ")})` : orParts[0];
    })
    .filter((token): token is string => Boolean(token));
}

function normalizeSearchFields(fields?: string[] | null) {
  const selected = (fields ?? []).filter(Boolean);
  if (selected.length === 0) {
    return ["fromAddr", "toAddr", "ccAddr", "bccAddr", "subject", "body"];
  }
  const columns = new Set<string>();
  selected.forEach((field) => {
    if (field === "sender") columns.add("fromAddr");
    if (field === "participants") {
      columns.add("fromAddr");
      columns.add("toAddr");
      columns.add("ccAddr");
      columns.add("bccAddr");
    }
    if (field === "subject") columns.add("subject");
    if (field === "body") columns.add("body");
  });
  if (columns.size === 0) {
    return [];
  }
  return Array.from(columns);
}

function shouldSearchAttachmentFilenames(fields?: string[] | null) {
  const selected = (fields ?? []).map((field) => field.trim()).filter(Boolean);
  if (selected.length === 0) return true;
  return selected.includes("attachments");
}

function parseSearchInput(
  raw: string | null | undefined,
  fields?: string[] | null,
  accountEmail?: string | null
) {
  const input = raw ?? "";

  // Extract "from:" terms and handle "from:me"
  const fromTerms: string[] = [];
  const withoutFrom = input.replace(/(^|\s)from:("([^"]+)"|\S+)/gi, (match, lead, term) => {
    const cleaned = term.replace(/^"|"$/g, "").trim();
    if (cleaned) {
      // Handle "from:me" - replace with current account email
      if (cleaned.toLowerCase() === "me" && accountEmail) {
        fromTerms.push(accountEmail);
      } else {
        fromTerms.push(cleaned);
      }
    }
    return lead ? " " : "";
  });

  // Extract "to:" terms (searches in To, Cc, and Bcc fields)
  const toTerms: string[] = [];
  const withoutTo = withoutFrom.replace(/(^|\s)to:("([^"]+)"|\S+)/gi, (match, lead, term) => {
    const cleaned = term.replace(/^"|"$/g, "").trim();
    if (cleaned) toTerms.push(cleaned);
    return lead ? " " : "";
  });

  // Extract "in:" terms (searches in folder names)
  const inTerms: string[] = [];
  const withoutIn = withoutTo.replace(/(^|\s)in:("([^"]+)"|\S+)/gi, (match, lead, term) => {
    const cleaned = term.replace(/^"|"$/g, "").trim();
    if (cleaned) inTerms.push(cleaned);
    return lead ? " " : "";
  });

  // Extract "invite:" / "event:" terms (calendar invite UID)
  const inviteUidTerms: string[] = [];
  const withoutInviteUid = withoutIn.replace(
    /(^|\s)(invite|event):("([^"]+)"|\S+)/gi,
    (match, lead, _prefix, term) => {
      const cleaned = term.replace(/^"|"$/g, "").trim().toLowerCase();
      if (cleaned) inviteUidTerms.push(cleaned);
      return lead ? " " : "";
    }
  );

  // Extract "thread:" terms (exact thread ID match)
  const threadTerms: string[] = [];
  const withoutThread = withoutInviteUid.replace(
    /(^|\s)thread:("([^"]+)"|\S+)/gi,
    (match, lead, term) => {
      const cleaned = term.replace(/^"|"$/g, "").trim();
      if (cleaned) threadTerms.push(cleaned);
      return lead ? " " : "";
    }
  );

  // Extract "topic:" terms (exact topic ID match)
  const topicTerms: string[] = [];
  const withoutTopic = withoutThread.replace(
    /(^|\s)topic:("([^"]+)"|\S+)/gi,
    (match, lead, term) => {
      const cleaned = term.replace(/^"|"$/g, "").trim();
      if (cleaned) topicTerms.push(cleaned);
      return lead ? " " : "";
    }
  );

  const rawQuery = withoutTopic.trim();
  const queryTokens = buildSearchTokens(withoutTopic);
  const columns = normalizeSearchFields(fields);
  const includeAttachmentFilenames = shouldSearchAttachmentFilenames(fields);
  const ftsTokenQueries = buildScopedFtsTokenQueries(queryTokens, columns);
  const attachmentFilenameTerms = includeAttachmentFilenames
    ? queryTokens.map((token) => token.toLowerCase())
    : [];
  return {
    ftsTokenQueries,
    fromTerms,
    toTerms,
    inTerms,
    inviteUidTerms,
    threadTerms,
    topicTerms,
    rawQuery,
    attachmentFilenameTerms
  };
}

function applySearchQueryFilters(params: {
  where: string;
  args: any[];
  ftsTokenQueries: string[];
  rawQuery: string;
  attachmentFilenameTerms: string[];
  messageAlias?: string;
}) {
  const messageAlias = params.messageAlias ?? "m";
  const ftsTokenQueries = params.ftsTokenQueries;
  const hasQuery = ftsTokenQueries.length > 0;
  const idQuery = params.rawQuery.trim();
  const hasIdQuery = Boolean(idQuery);
  const attachmentFilenameTerms = params.attachmentFilenameTerms;
  const hasAttachmentFilenameQuery = attachmentFilenameTerms.length > 0;
  if (!hasQuery && !hasIdQuery && !hasAttachmentFilenameQuery) {
    return {
      where: params.where,
      hasQuery,
      hasIdQuery,
      hasAttachmentFilenameQuery
    };
  }

  const clauses: string[] = [];
  if (hasQuery || hasAttachmentFilenameQuery) {
    const tokenCount = Math.max(ftsTokenQueries.length, attachmentFilenameTerms.length);
    const tokenClauses: string[] = [];
    for (let index = 0; index < tokenCount; index += 1) {
      const tokenParts: string[] = [];
      const ftsTokenQuery = ftsTokenQueries[index];
      if (ftsTokenQuery) {
        tokenParts.push(
          `${messageAlias}.id IN (SELECT messageId FROM message_fts WHERE message_fts MATCH ?)`
        );
        params.args.push(ftsTokenQuery);
      }
      const attachmentTerm = attachmentFilenameTerms[index];
      if (attachmentTerm) {
        tokenParts.push(
          `EXISTS (
            SELECT 1
            FROM attachments a
            WHERE a.messageId = ${messageAlias}.id
              AND lower(COALESCE(a.filename, '')) LIKE ?
          )`
        );
        params.args.push(`%${attachmentTerm}%`);
      }
      if (tokenParts.length === 0) continue;
      tokenClauses.push(tokenParts.length > 1 ? `(${tokenParts.join(" OR ")})` : tokenParts[0]);
    }
    if (tokenClauses.length > 0) {
      clauses.push(`(${tokenClauses.join(" AND ")})`);
    }
  }
  if (hasIdQuery) {
    clauses.push(`lower(${messageAlias}.messageId) LIKE ?`);
    clauses.push(`lower(${messageAlias}.threadId) LIKE ?`);
    clauses.push(`lower(${messageAlias}.id) LIKE ?`);
  }
  const where = `${params.where} AND (${clauses.join(" OR ")})`;
  if (hasIdQuery) {
    const pattern = `%${idQuery.toLowerCase()}%`;
    params.args.push(pattern, pattern, pattern);
  }
  return {
    where,
    hasQuery,
    hasIdQuery,
    hasAttachmentFilenameQuery
  };
}

function buildCalendarEventUidMatchSql(calendarEventAlias = "mce") {
  return `lower(COALESCE(${calendarEventAlias}.eventUidKey, ${calendarEventAlias}.eventUid, ''))`;
}

function applyInviteUidQueryFilters(params: {
  where: string;
  args: any[];
  accountId: string;
  inviteUidTerms: string[];
  messageAlias?: string;
}) {
  const normalizedInviteUidTerms = normalizeCalendarEventUidKeys(params.inviteUidTerms);
  if (normalizedInviteUidTerms.length === 0) {
    return params.where;
  }
  const messageAlias = params.messageAlias ?? "m";
  normalizedInviteUidTerms.forEach(() => {
    params.where += ` AND EXISTS (
      SELECT 1
      FROM message_calendar_events mce
      WHERE mce.accountId = ?
        AND mce.messageId = ${messageAlias}.id
        AND ${buildCalendarEventUidMatchSql("mce")} LIKE ?
    )`;
  });
  normalizedInviteUidTerms.forEach((term) => {
    params.args.push(params.accountId, `%${term}%`);
  });
  return params.where;
}

function parseReferences(value?: string | null) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter(Boolean);
    }
  } catch {
    const parts = value.split(/\s+/).filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  }
  return undefined;
}

function parseStringArray(value?: string | null) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter(Boolean);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function normalizeCalendarInviteActionType(
  value?: string | null
): CalendarInviteActionType | null {
  if (value === "invitation" || value === "update" || value === "cancellation") {
    return value;
  }
  return null;
}

function mapMessageCalendarInviteStateRow(
  row: {
    eventUid?: string | null;
    inviteActionType?: string | null;
    processedAtMs?: number | null;
    processedByUserId?: string | null;
  }
): MessageCalendarInviteState | null {
  const eventUid = normalizeCalendarEventUid(row.eventUid);
  const actionType = normalizeCalendarInviteActionType(row.inviteActionType);
  if (!eventUid || !actionType) return null;
  return {
    eventUid,
    actionType,
    processedAtMs:
      typeof row.processedAtMs === "number" && Number.isFinite(row.processedAtMs)
        ? row.processedAtMs
        : undefined,
    processedByUserId:
      typeof row.processedByUserId === "string" && row.processedByUserId.trim()
        ? row.processedByUserId.trim()
        : undefined
  };
}

export async function upsertMessageCalendarInviteStates(
  accountId: string,
  messageId: string,
  states: Array<{
    eventUid: string;
    actionType: CalendarInviteActionType;
    eventFirstStartAtMs?: number;
    eventLastEndAtMs?: number | null;
  }>
) {
  return withDbWriteRetry("upsertMessageCalendarInviteStates", async () => {
    const db = await getAccountDb(accountId);
    ensureMessageCalendarEventOptionalColumns(db);
    const insert = db.prepare(
      `INSERT INTO message_calendar_events (
         accountId,
         messageId,
         eventUid,
         eventUidKey,
         eventFirstStartAtMs,
         eventLastEndAtMs,
         inviteActionType
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(accountId, messageId, eventUid)
       DO UPDATE SET
         eventUidKey = excluded.eventUidKey,
         eventFirstStartAtMs = excluded.eventFirstStartAtMs,
         eventLastEndAtMs = excluded.eventLastEndAtMs,
         inviteActionType = excluded.inviteActionType`
    );
    const apply = db.transaction(
      (
        items: Array<{
          eventUid: string;
          actionType: CalendarInviteActionType;
          eventFirstStartAtMs?: number;
          eventLastEndAtMs?: number | null;
        }>
      ) => {
        items.forEach((item) => {
          const eventUid = normalizeCalendarEventUid(item.eventUid);
          const eventUidKey = normalizeCalendarEventUidKey(eventUid);
          const actionType = normalizeCalendarInviteActionType(item.actionType);
          if (!eventUid || !actionType) return;
          const eventFirstStartAtMs =
            typeof item.eventFirstStartAtMs === "number" &&
            Number.isFinite(item.eventFirstStartAtMs) &&
            item.eventFirstStartAtMs > 0
              ? Math.round(item.eventFirstStartAtMs)
              : null;
          const eventLastEndAtMs =
            item.eventLastEndAtMs === null
              ? null
              : typeof item.eventLastEndAtMs === "number" &&
                  Number.isFinite(item.eventLastEndAtMs) &&
                  item.eventLastEndAtMs > 0
                ? Math.round(item.eventLastEndAtMs)
                : eventFirstStartAtMs
                  ? null
                  : null;
          insert.run(
            accountId,
            messageId,
            eventUid,
            eventUidKey,
            eventFirstStartAtMs,
            eventLastEndAtMs,
            actionType
          );
        });
      }
    );
    apply(itemsFromUniqueInviteStates(states));
  });
}

export async function markMessageCalendarInviteStatesProcessed(
  accountId: string,
  messageId: string,
  eventUids: string[],
  processedByUserId?: string | null
) {
  return withDbWriteRetry("markMessageCalendarInviteStatesProcessed", async () => {
    const db = await getAccountDb(accountId);
    ensureMessageCalendarEventOptionalColumns(db);
    const normalizedEventUids = normalizeCalendarEventUids(eventUids);
    if (normalizedEventUids.length === 0) return 0;
    const now = Date.now();
    const result = db
      .prepare(
        `UPDATE message_calendar_events
         SET processedAtMs = ?, processedByUserId = ?
         WHERE accountId = ?
           AND messageId = ?
           AND eventUid IN (${normalizedEventUids.map(() => "?").join(",")})`
      )
      .run(
        now,
        typeof processedByUserId === "string" && processedByUserId.trim()
          ? processedByUserId.trim()
          : null,
        accountId,
        messageId,
        ...normalizedEventUids
      ) as { changes?: number };
    return result?.changes ?? 0;
  });
}

export async function clearMessageCalendarInviteStatesProcessedByEventUid(
  accountId: string,
  eventUid: string
) {
  return withDbWriteRetry("clearMessageCalendarInviteStatesProcessedByEventUid", async () => {
    const db = await getAccountDb(accountId);
    ensureMessageCalendarEventOptionalColumns(db);
    const normalizedEventUid = normalizeCalendarEventUid(eventUid);
    if (!normalizedEventUid) return 0;
    const result = db
      .prepare(
        `UPDATE message_calendar_events
         SET processedAtMs = NULL, processedByUserId = NULL
         WHERE accountId = ? AND lower(eventUid) = lower(?)`
      )
      .run(accountId, normalizedEventUid) as { changes?: number };
    return result?.changes ?? 0;
  });
}

export async function deleteMessageCalendarInviteStateByMessageAndEvent(
  accountId: string,
  messageId: string,
  eventUid: string
): Promise<void> {
  const db = await getAccountDb(accountId);
  const normalizedEventUid = normalizeCalendarEventUid(eventUid);
  if (!normalizedEventUid) return;
  db.prepare(
    `DELETE FROM message_calendar_events
     WHERE accountId = ? AND messageId = ? AND lower(eventUid) = lower(?)`
  ).run(accountId, messageId, normalizedEventUid);
}

export async function listCalendarInviteSourceMessagesByEventUid(
  accountId: string,
  eventUid: string,
  options?: {
    excludeMessageId?: string | null;
  }
): Promise<
  Array<{
    messageId: string;
    dateValue: number;
  }>
> {
  const db = await getAccountDb(accountId);
  ensureMessageCalendarEventOptionalColumns(db);
  const normalizedEventUid = normalizeCalendarEventUid(eventUid);
  if (!normalizedEventUid) return [];
  const excludedMessageId =
    typeof options?.excludeMessageId === "string" && options.excludeMessageId.trim()
      ? options.excludeMessageId.trim()
      : "";
  const rows = db
    .prepare(
      `SELECT DISTINCT
         m.id AS messageId,
         m.dateValue AS dateValue
       FROM message_calendar_events mce
       JOIN messages m
         ON m.accountId = mce.accountId
        AND m.id = mce.messageId
       WHERE mce.accountId = ?
         AND lower(mce.eventUid) = lower(?)
         AND COALESCE(m.hasSource, 0) = 1
         AND (? = '' OR m.id <> ?)
       ORDER BY m.dateValue ASC, m.id ASC`
    )
    .all(accountId, normalizedEventUid, excludedMessageId, excludedMessageId) as Array<{
    messageId?: string | null;
    dateValue?: number | null;
  }>;
  return rows
    .map((row) => {
      const messageId = String(row.messageId ?? "").trim();
      const dateValue =
        typeof row.dateValue === "number" && Number.isFinite(row.dateValue) ? row.dateValue : 0;
      if (!messageId) return null;
      return { messageId, dateValue };
    })
    .filter((row): row is { messageId: string; dateValue: number } => Boolean(row));
}

function itemsFromUniqueInviteStates(
  states: Array<{
    eventUid: string;
    actionType: CalendarInviteActionType;
    eventFirstStartAtMs?: number;
    eventLastEndAtMs?: number | null;
  }>
) {
  const deduped = new Map<
    string,
    {
      eventUid: string;
      actionType: CalendarInviteActionType;
      eventFirstStartAtMs?: number;
      eventLastEndAtMs?: number | null;
    }
  >();
  states.forEach((state) => {
    const eventUid = normalizeCalendarEventUid(state.eventUid);
    const actionType = normalizeCalendarInviteActionType(state.actionType);
    if (!eventUid || !actionType) return;
    deduped.set(eventUid, {
      eventUid,
      actionType,
      eventFirstStartAtMs: state.eventFirstStartAtMs,
      eventLastEndAtMs: state.eventLastEndAtMs
    });
  });
  return Array.from(deduped.values());
}

function normalizeCategory(value?: string | null): CategoryKey | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return CATEGORY_KEYS.includes(normalized as CategoryKey)
    ? (normalized as CategoryKey)
    : null;
}

function normalizeCategoryManualState(value?: string | null): CategoryManualState | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "cleared") return "cleared";
  return null;
}

function buildMessageCollisionVariantId(
  baseId: string,
  mailboxPath?: string | null,
  imapUid?: number | null
) {
  const normalizedMailboxPath = (mailboxPath ?? "").trim().toLowerCase();
  const normalizedUid =
    typeof imapUid === "number" && Number.isFinite(imapUid) ? String(imapUid) : "";
  const suffix = createHash("sha1")
    .update(`${baseId}|${normalizedMailboxPath}|${normalizedUid}`)
    .digest("hex")
    .slice(0, 12);
  return `${baseId}-${suffix}`;
}

function normalizeSubjectLine(subject?: string | null) {
  let value = (subject ?? "").trim().toLowerCase();
  if (!value) return "";
  let previous = "";
  while (value !== previous) {
    previous = value;
    value = value.replace(/^(re|fw|fwd|aw|wg)\s*:\s*/i, "");
    value = value.replace(/^\[(re|fw|fwd|aw|wg)\]\s*/i, "");
    value = value.trim();
  }
  return value;
}

function extractEmailsFromText(value?: string | null) {
  if (!value) return [];
  const matches = value.toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g);
  return matches ? Array.from(new Set(matches)) : [];
}

function buildThreadLatestReceivedDateSql(messageAlias: string, accountEmail: string) {
  if (!accountEmail) {
    return `MAX(${messageAlias}.dateValue)`;
  }
  return `COALESCE(
    MAX(
      CASE
        WHEN lower(COALESCE(${messageAlias}.fromEmail, '')) = ?
          OR instr(lower(COALESCE(${messageAlias}.fromAddr, '')), ?) > 0
          THEN NULL
        ELSE ${messageAlias}.dateValue
      END
    ),
    MAX(${messageAlias}.dateValue)
  )`;
}

function getThreadLatestReceivedDateArgs(accountEmail: string) {
  if (!accountEmail) return [];
  return [accountEmail, accountEmail];
}

function getThreadDateColumn(
  groupBy: string,
  threadDateSource: ThreadDateSource = DEFAULT_THREAD_DATE_SOURCE
) {
  if (!isThreadDateSensitiveGroupBy(groupBy)) {
    return "latestDateValue";
  }
  return threadDateSource === "latestDateValue" ? "latestDateValue" : "latestReceivedDateValue";
}

type MessageSystemFlagState = {
  seen: number;
  answered: number;
  flagged: number;
  deleted: number;
  draft: number;
  recent: number;
  unread: number;
};

type CategoryManualState = "cleared";

type UpsertFileMove = {
  previousMessageId: string;
  nextMessageId: string;
  attachmentIds: string[];
};

function deriveSystemFlagState(flags: string[]): MessageSystemFlagState {
  const hasFlag = (flag: string) =>
    flags.some((value) => value.toLowerCase() === flag.toLowerCase());
  const seen = hasFlag("\\Seen");
  return {
    seen: seen ? 1 : 0,
    answered: hasFlag("\\Answered") ? 1 : 0,
    flagged: hasFlag("\\Flagged") ? 1 : 0,
    deleted: hasFlag("\\Deleted") ? 1 : 0,
    draft: hasFlag("\\Draft") ? 1 : 0,
    recent: hasFlag("\\Recent") ? 1 : 0,
    unread: seen ? 0 : 1
  };
}

function applyBadgeFilters(where: string, args: any[], badges?: string[] | null) {
  const normalized = (badges ?? []).map((badge) => badge.toLowerCase());
  const todoFlagPattern = `%"${TODO_FLAG.toLowerCase()}"%`;
  const doneFlagPattern = `%"${DONE_FLAG.toLowerCase()}"%`;
  if (normalized.includes("unread")) {
    where += " AND m.unread = 1";
  }
  if (normalized.includes("unanswered")) {
    where += " AND COALESCE(m.answered, 0) = 0";
  }
  if (normalized.includes("flagged")) {
    where += " AND m.flagged = 1";
  }
  if (normalized.includes("todo")) {
    where += " AND m.flags IS NOT NULL AND lower(m.flags) LIKE ?";
    args.push(todoFlagPattern);
  }
  if (normalized.includes("done")) {
    where += " AND m.flags IS NOT NULL AND lower(m.flags) LIKE ?";
    args.push(doneFlagPattern);
  }
  if (normalized.includes("attention")) {
    // Action Queue: flagged OR todo OR done
    where += " AND (m.flagged = 1 OR (m.flags IS NOT NULL AND (lower(m.flags) LIKE ? OR lower(m.flags) LIKE ?)))";
    args.push(todoFlagPattern, doneFlagPattern);
  }
  if (normalized.includes("calendar")) {
    where += " AND m.flags IS NOT NULL AND lower(m.flags) LIKE ?";
    args.push(`%"${CALENDAR_INVITE_FLAG}"%`);
  }
  // Category filters
  if (normalized.includes("newsletter")) {
    where += " AND m.category = ?";
    args.push("newsletter");
  }
  if (normalized.includes("focused")) {
    where +=
      " AND m.unread = 1 AND COALESCE(m.answered, 0) = 0 AND COALESCE(m.category, '') <> ?";
    args.push("newsletter");
  }
  if (normalized.includes("notification")) {
    where += " AND m.category = ?";
    args.push("notification");
  }
  if (normalized.includes("transactional")) {
    where += " AND m.category = ?";
    args.push("transactional");
  }
  return where;
}

function applyExcludedFolderFilters(
  where: string,
  args: any[],
  excludedFolderIds?: string[] | null,
  alias = "m"
) {
  const normalized = Array.from(
    new Set((excludedFolderIds ?? []).map((value) => value.trim()).filter(Boolean))
  );
  if (normalized.length === 0) return where;
  where += ` AND ${alias}.folderId NOT IN (${normalized.map(() => "?").join(",")})`;
  args.push(...normalized);
  return where;
}

function applyVisibleMessageFilters(where: string, alias = "m") {
  return `${where} AND COALESCE(${alias}.deleted, 0) = 0`;
}

function escapeSqlLiteral(value: string) {
  return value.replaceAll("'", "''");
}

function buildSqlContainsAny(valueSql: string, hints: readonly string[]) {
  if (hints.length === 0) return "0";
  return hints
    .map((hint) => `${valueSql} LIKE '%${escapeSqlLiteral(hint.toLowerCase())}%'`)
    .join(" OR ");
}

function buildSqlEndsWithAny(valueSql: string, suffixes: readonly string[]) {
  if (suffixes.length === 0) return "0";
  return suffixes
    .map((suffix) => `${valueSql} LIKE '%${escapeSqlLiteral(suffix.toLowerCase())}'`)
    .join(" OR ");
}

function buildMeaningfulAttachmentPredicateSql(attachmentAlias = "a") {
  const contentTypeSql = `lower(COALESCE(${attachmentAlias}.contentType, ''))`;
  const filenameSql = `lower(COALESCE(${attachmentAlias}.filename, ''))`;
  const calendarSql = `(${buildSqlContainsAny(contentTypeSql, CALENDAR_MIME_HINTS)} OR ${buildSqlEndsWithAny(filenameSql, CALENDAR_FILENAME_EXTENSIONS)})`;
  const signatureSql = `(${buildSqlContainsAny(contentTypeSql, CRYPTO_SIGNATURE_MIME_HINTS)} OR ${buildSqlEndsWithAny(filenameSql, CRYPTO_SIGNATURE_FILENAME_EXTENSIONS)})`;
  return `${attachmentAlias}.inline = 0
    AND COALESCE(${attachmentAlias}.size, 0) >= ${MIN_VISIBLE_ATTACHMENT_SIZE_BYTES}
    AND NOT ${calendarSql}
    AND NOT ${signatureSql}`;
}

function buildMeaningfulAttachmentExistsSql(messageAlias = "m", attachmentAlias = "a") {
  return `EXISTS (
    SELECT 1
    FROM attachments ${attachmentAlias}
    WHERE ${attachmentAlias}.messageId = ${messageAlias}.id
      AND ${buildMeaningfulAttachmentPredicateSql(attachmentAlias)}
  )`;
}

const RELATED_TRASH_SPECIAL_USES = new Set(["\\trash"]);
const RELATED_SPAM_SPECIAL_USES = new Set(["\\junk", "\\spam"]);
const RELATED_TRASH_KEYWORDS = ["trash", "deleted", "bin", "wastebasket", "papierkorb"];
const RELATED_SPAM_KEYWORDS = ["junk", "spam", "bulk"];

function getRelatedExcludedFolderIds(db: any, accountId: string) {
  const folders = db
    .prepare(`SELECT id, name, specialUse FROM folders WHERE accountId = ?`)
    .all(accountId) as Array<{ id: string; name?: string | null; specialUse?: string | null }>;
  return folders
    .filter((folder) => {
      const special = (folder.specialUse ?? "").trim().toLowerCase();
      if (RELATED_TRASH_SPECIAL_USES.has(special) || RELATED_SPAM_SPECIAL_USES.has(special)) {
        return true;
      }
      const name = (folder.name ?? "").trim().toLowerCase();
      const id = folder.id.toLowerCase();
      const trashMatch = RELATED_TRASH_KEYWORDS.some(
        (keyword) => name.includes(keyword) || id.includes(keyword)
      );
      if (trashMatch) return true;
      return RELATED_SPAM_KEYWORDS.some(
        (keyword) => name.includes(keyword) || id.includes(keyword)
      );
    })
    .map((folder) => folder.id);
}

function groupsFromRows(
  rows: Array<{ key: string; count: number }>,
  groupBy: string
): GroupMeta[] {
  return rows.map((row) => ({
    key: row.key,
    label: buildGroupLabel(row.key, groupBy),
    count: row.count
  }));
}

async function getGroupCounts(params: {
  accountId: string;
  folderId?: string | null;
  query?: string | null;
  groupBy: string;
  fields?: string[] | null;
  badges?: string[] | null;
  attachmentsOnly?: boolean;
  excludedFolderIds?: string[] | null;
}) {
  const { accountId, folderId, query, groupBy, fields, badges, attachmentsOnly, excludedFolderIds } =
    params;
  const db = await getAccountDb(accountId);
  const accountEmail = await getAccountEmail(accountId);

  const { ftsTokenQueries, fromTerms, toTerms, inTerms, inviteUidTerms, threadTerms, topicTerms, rawQuery, attachmentFilenameTerms } = parseSearchInput(
    query,
    fields,
    accountEmail
  );
  const baseWhere = `m.accountId = ? ${folderId ? "AND m.folderId = ?" : ""}`;
  const args: any[] = [accountId];
  if (folderId) args.push(folderId);
  let where = applyVisibleMessageFilters(baseWhere);

  // Apply "from:" filter
  fromTerms.forEach(() => {
    where += " AND lower(m.fromAddr) LIKE ?";
  });
  fromTerms.forEach((term) => args.push(`%${term.toLowerCase()}%`));

  // Apply "to:" filter (searches in To, Cc, and Bcc fields)
  toTerms.forEach(() => {
    where += " AND (lower(m.toAddr) LIKE ? OR lower(m.ccAddr) LIKE ? OR lower(m.bccAddr) LIKE ?)";
  });
  toTerms.forEach((term) => {
    const pattern = `%${term.toLowerCase()}%`;
    args.push(pattern, pattern, pattern);
  });

  // Apply "thread:" filter (exact thread ID match)
  threadTerms.forEach(() => {
    where += " AND m.threadId = ?";
  });
  threadTerms.forEach((term) => args.push(term));

  // Apply "topic:" filter (messages assigned to a topic)
  topicTerms.forEach((topicId) => {
    where += " AND EXISTS (SELECT 1 FROM thread_topics tt WHERE tt.threadId = m.threadId AND tt.topicId = ?)";
    args.push(topicId);
  });

  // Apply "in:" filter (searches in folder names)
  if (inTerms.length > 0) {
    const folderRows = db
      .prepare(
        `SELECT id FROM folders WHERE accountId = ? AND (${inTerms
          .map(() => "lower(name) LIKE ?")
          .join(" OR ")})`
      )
      .all(accountId, ...inTerms.map((term) => `%${term.toLowerCase()}%`)) as Array<{ id: string }>;
    const folderIds = folderRows.map((row) => row.id);
    if (folderIds.length > 0) {
      where += ` AND m.folderId IN (${folderIds.map(() => "?").join(",")})`;
      args.push(...folderIds);
    } else {
      // No matching folders, so no messages will match
      where += " AND 0 = 1";
    }
  }
  where = applySearchQueryFilters({
    where,
    args,
    ftsTokenQueries,
    rawQuery,
    attachmentFilenameTerms
  }).where;
  where = applyInviteUidQueryFilters({ where, args, accountId, inviteUidTerms });
  where = applyBadgeFilters(where, args, badges);
  where = applyExcludedFolderFilters(where, args, excludedFolderIds);
  const attachmentsFilter = attachmentsOnly ?? badges?.includes("attachments");
  if (attachmentsFilter) {
    where += ` AND ${buildMeaningfulAttachmentExistsSql("m")}`;
  }

  if (groupBy === "date" || groupBy === INVITE_DECK_GROUP_BY) {
    if (groupBy === INVITE_DECK_GROUP_BY) {
      const inviteDeckSummary = await getInviteDeckGroupSummary({
        db,
        accountId,
        where,
        args
      });
      return inviteDeckSummary.groups;
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sql =
      `
        SELECT
          CASE
            WHEN m.dateValue >= ? THEN 'Today'
            WHEN m.dateValue >= ? THEN 'Yesterday'
            WHEN m.dateValue >= ? THEN 'This Week'
            ELSE 'Older'
          END as key,
          COUNT(*) as count
        FROM messages m
        WHERE ${where}
        GROUP BY key
      `;
    const rows = db
      .prepare(sql)
      .all(todayStart, todayStart - 24 * 60 * 60 * 1000, todayStart - 7 * 24 * 60 * 60 * 1000, ...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(sortGroupsForGroupBy(rows, groupBy), groupBy);
  }

  if (groupBy === "week") {
    const rows = db
      .prepare(
        `
        SELECT strftime('%Y-W%W', m.dateValue / 1000, 'unixepoch', 'localtime') as key,
               COUNT(*) as count
        FROM messages m
        WHERE ${where}
        GROUP BY key
        ORDER BY key DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  if (groupBy === "year") {
    const rows = db
      .prepare(
        `
        SELECT strftime('%Y', m.dateValue / 1000, 'unixepoch', 'localtime') as key,
               COUNT(*) as count
        FROM messages m
        WHERE ${where}
        GROUP BY key
        ORDER BY key DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  if (groupBy === "domain") {
    const rows = db
      .prepare(
        `
        SELECT
          CASE
            WHEN m.fromEmail IS NOT NULL AND instr(m.fromEmail, '@') > 0
              THEN lower(substr(m.fromEmail, instr(m.fromEmail, '@') + 1))
            ELSE 'Unknown'
          END as key,
          COUNT(*) as count
        FROM messages m
        WHERE ${where}
        GROUP BY key
        ORDER BY count DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  if (groupBy === "sender") {
    const rows = db
      .prepare(
        `
        SELECT m.fromAddr as key, COUNT(*) as count
        FROM messages m
        WHERE ${where}
        GROUP BY key
        ORDER BY count DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  if (groupBy === "folder") {
    const rows = db
      .prepare(
        `
        SELECT m.folderId as key, COUNT(*) as count
        FROM messages m
        WHERE ${where}
        GROUP BY key
        ORDER BY count DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  return [
    {
      key: "All",
      label: "All",
      count: await getTotalCount({
        accountId,
        folderId,
        query: query ?? undefined,
        fields,
        excludedFolderIds
      })
    }
  ];
}

async function getTotalCount(params: {
  accountId: string;
  folderId?: string | null;
  query?: string;
  fields?: string[] | null;
  badges?: string[] | null;
  attachmentsOnly?: boolean;
  excludedFolderIds?: string[] | null;
}) {
  const db = await getAccountDb(params.accountId);
  const { accountId, folderId, query, fields, badges, attachmentsOnly, excludedFolderIds } =
    params;
  const accountEmail = await getAccountEmail(accountId);

  const { ftsTokenQueries, fromTerms, toTerms, inTerms, inviteUidTerms, threadTerms, topicTerms, rawQuery, attachmentFilenameTerms } = parseSearchInput(
    query,
    fields,
    accountEmail
  );
  const baseWhere = `m.accountId = ? ${folderId ? "AND m.folderId = ?" : ""}`;
  const args: any[] = [accountId];
  if (folderId) args.push(folderId);
  let where = applyVisibleMessageFilters(baseWhere);

  // Apply "from:" filter
  fromTerms.forEach(() => {
    where += " AND lower(m.fromAddr) LIKE ?";
  });
  fromTerms.forEach((term) => args.push(`%${term.toLowerCase()}%`));

  // Apply "to:" filter (searches in To, Cc, and Bcc fields)
  toTerms.forEach(() => {
    where += " AND (lower(m.toAddr) LIKE ? OR lower(m.ccAddr) LIKE ? OR lower(m.bccAddr) LIKE ?)";
  });
  toTerms.forEach((term) => {
    const pattern = `%${term.toLowerCase()}%`;
    args.push(pattern, pattern, pattern);
  });

  // Apply "thread:" filter (exact thread ID match)
  threadTerms.forEach(() => {
    where += " AND m.threadId = ?";
  });
  threadTerms.forEach((term) => args.push(term));

  // Apply "topic:" filter (messages assigned to a topic)
  topicTerms.forEach((topicId) => {
    where += " AND EXISTS (SELECT 1 FROM thread_topics tt WHERE tt.threadId = m.threadId AND tt.topicId = ?)";
    args.push(topicId);
  });

  // Apply "in:" filter (searches in folder names)
  if (inTerms.length > 0) {
    const folderRows = db
      .prepare(
        `SELECT id FROM folders WHERE accountId = ? AND (${inTerms
          .map(() => "lower(name) LIKE ?")
          .join(" OR ")})`
      )
      .all(accountId, ...inTerms.map((term) => `%${term.toLowerCase()}%`)) as Array<{ id: string }>;
    const folderIds = folderRows.map((row) => row.id);
    if (folderIds.length > 0) {
      where += ` AND m.folderId IN (${folderIds.map(() => "?").join(",")})`;
      args.push(...folderIds);
    } else {
      // No matching folders, so no messages will match
      where += " AND 0 = 1";
    }
  }
  where = applySearchQueryFilters({
    where,
    args,
    ftsTokenQueries,
    rawQuery,
    attachmentFilenameTerms
  }).where;
  where = applyInviteUidQueryFilters({ where, args, accountId, inviteUidTerms });
  where = applyBadgeFilters(where, args, badges);
  where = applyExcludedFolderFilters(where, args, excludedFolderIds);
  const attachmentsFilter = attachmentsOnly ?? badges?.includes("attachments");
  if (attachmentsFilter) {
    where += ` AND ${buildMeaningfulAttachmentExistsSql("m")}`;
  }
  const row = db
    .prepare(
      `
      SELECT COUNT(*) as count
      FROM messages m
      WHERE ${where}
    `
    )
    .get(...args) as { count: number };
  return row?.count ?? 0;
}

async function getThreadGroupCounts(params: {
  db: any;
  accountId: string;
  where: string;
  args: any[];
  groupBy: string;
  threadDateColumn: string;
}) {
  const { db, where, args, groupBy, threadDateColumn } = params;
  const joinFrom = `
    FROM messages m
    JOIN threads t
      ON t.accountId = m.accountId
     AND t.threadId = m.threadId
  `;

  if (groupBy === "date") {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const rows = db
      .prepare(
        `
        SELECT
          CASE
            WHEN t.${threadDateColumn} >= ? THEN 'Today'
            WHEN t.${threadDateColumn} >= ? THEN 'Yesterday'
            WHEN t.${threadDateColumn} >= ? THEN 'This Week'
            ELSE 'Older'
          END as key,
          COUNT(*) as count
        ${joinFrom}
        WHERE ${where}
        GROUP BY key
      `
      )
      .all(
        todayStart,
        todayStart - 24 * 60 * 60 * 1000,
        todayStart - 7 * 24 * 60 * 60 * 1000,
        ...args
      ) as Array<{ key: string; count: number }>;
    return groupsFromRows(sortGroupsForGroupBy(rows, groupBy), groupBy);
  }

  if (groupBy === "week") {
    const rows = db
      .prepare(
        `
        SELECT strftime('%Y-W%W', t.${threadDateColumn} / 1000, 'unixepoch', 'localtime') as key,
               COUNT(*) as count
        ${joinFrom}
        WHERE ${where}
        GROUP BY key
        ORDER BY key DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  if (groupBy === "year") {
    const rows = db
      .prepare(
        `
        SELECT strftime('%Y', t.${threadDateColumn} / 1000, 'unixepoch', 'localtime') as key,
               COUNT(*) as count
        ${joinFrom}
        WHERE ${where}
        GROUP BY key
        ORDER BY key DESC
      `
      )
      .all(...args) as Array<{ key: string; count: number }>;
    return groupsFromRows(rows, groupBy);
  }

  return [];
}

export async function listRelatedMessages(params: {
  accountId: string;
  relatedId: string;
  page: number;
  pageSize: number;
  groupBy?: string;
  badges?: string[] | null;
  attachmentsOnly?: boolean;
  excludedFolderIds?: string[] | null;
}) {
  const {
    accountId,
    relatedId,
    page,
    pageSize,
    groupBy = "date",
    badges,
    attachmentsOnly,
    excludedFolderIds
  } = params;
  const db = await getAccountDb(accountId);
  const normalizedId = relatedId.trim();
  if (!normalizedId) {
    return { items: [] as Message[], groups: [], total: 0, hasMore: false, baseCount: 0 };
  }

  const accountEmail = await getAccountEmail(accountId);

  const findTarget = (id: string) =>
    db
      .prepare(
        `SELECT * FROM messages WHERE accountId = ? AND (id = ? OR messageId = ?) LIMIT 1`
      )
      .get(accountId, id, id) as any;
  let target = findTarget(normalizedId);
  if (!target) {
    const trimmed = normalizedId.replace(/[<>]/g, "");
    if (trimmed && trimmed !== normalizedId) {
      target = db
        .prepare(
          `SELECT * FROM messages WHERE accountId = ? AND messageId LIKE ? LIMIT 1`
        )
        .get(accountId, `%${trimmed}%`) as any;
    }
  }
  if (!target) {
    return { items: [] as Message[], groups: [], total: 0, hasMore: false, baseCount: 0 };
  }

  const subjectNormalized = normalizeSubjectLine(target.subject);
  const subjectTokens = subjectNormalized
    ? subjectNormalized.split(/\s+/).filter((token) => token.length > 2).slice(0, 6)
    : [];

  const participantEmails = Array.from(
    new Set(
      [
        ...extractEmailsFromText(target.fromAddr),
        ...extractEmailsFromText(target.toAddr),
        ...extractEmailsFromText(target.ccAddr),
        ...extractEmailsFromText(target.bccAddr)
      ]
    )
  )
    .filter((email) => email && email !== accountEmail)
    .slice(0, 6);

  const targetRefs = new Set(
    [
      target.messageId,
      target.inReplyTo,
      ...(parseReferences(target.references) ?? [])
    ]
      .filter(Boolean)
      .map((value: string) => value.toLowerCase())
  );
  const targetCalendarEventUidKeys = normalizeCalendarEventUidKeys(
    (
      db
        .prepare(
          `SELECT eventUid
           FROM message_calendar_events
           WHERE accountId = ? AND messageId = ?`
        )
        .all(accountId, target.id) as Array<{ eventUid?: string | null }>
    ).map((row) => row.eventUid ?? undefined)
  );

  // Always include the reference message itself in related results.
  const clauses: string[] = ["m.id = ?"];
  const args: any[] = [accountId, target.id];

  if (subjectNormalized) {
    clauses.push("lower(m.subject) LIKE ?");
    args.push(`%${subjectNormalized}%`);
    subjectTokens.forEach((token) => {
      clauses.push("lower(m.subject) LIKE ?");
      args.push(`%${token}%`);
    });
  }

  participantEmails.forEach((email) => {
    clauses.push(
      "(lower(m.fromAddr) LIKE ? OR lower(m.toAddr) LIKE ? OR lower(m.ccAddr) LIKE ? OR lower(m.bccAddr) LIKE ?)"
    );
    const pattern = `%${email}%`;
    args.push(pattern, pattern, pattern, pattern);
  });

  if (target.threadId) {
    clauses.push("m.threadId = ?");
    args.push(target.threadId);
  }

  Array.from(targetRefs).slice(0, 8).forEach((ref) => {
    clauses.push(
      '(lower(m.messageId) = ? OR lower(m.inReplyTo) = ? OR lower(m."references") LIKE ?)'
    );
    args.push(ref, ref, `%${ref}%`);
  });
  if (targetCalendarEventUidKeys.length > 0) {
    clauses.push(
      `m.id IN (
         SELECT mce.messageId
         FROM message_calendar_events mce
         WHERE mce.accountId = ?
           AND ${buildCalendarEventUidMatchSql("mce")} IN (${targetCalendarEventUidKeys
             .map(() => "?")
             .join(",")})
       )`
    );
    args.push(accountId, ...targetCalendarEventUidKeys);
  }

  let where = `m.accountId = ? AND (${clauses.join(" OR ")})`;
  where = applyVisibleMessageFilters(where);
  where = applyBadgeFilters(where, args, badges);
  const effectiveExcludedFolderIds = Array.from(
    new Set([...(excludedFolderIds ?? []), ...getRelatedExcludedFolderIds(db, accountId)])
  );
  where = applyExcludedFolderFilters(where, args, effectiveExcludedFolderIds);
  const attachmentsFilter = attachmentsOnly ?? badges?.includes("attachments");
  if (attachmentsFilter) {
    where += ` AND ${buildMeaningfulAttachmentExistsSql("m")}`;
  }

  const rows = db
    .prepare(
      `
      SELECT
        m.id,
        m.accountId,
        m.folderId,
        m.mailboxPath,
        m.imapUid,
        m.threadId,
        m.parentId,
        m.messageId,
        m.inReplyTo,
        m."references" as "references",
        m.xForwardedMessageId,
        m.xComposeFormat,
        m.quotedHtmlEdited,
        m.subject,
        m.fromAddr,
        m.toAddr,
        m.ccAddr,
        m.bccAddr,
        m.preview,
        m.date,
        m.dateValue,
        m.priority,
        m.hasSource,
        m.unread,
        m.flags,
        m.seen,
        m.answered,
        m.flagged,
        m.deleted,
        m.draft,
        m.recent,
        m.category,
        m.categoryScore,
        m.categorySignals,
        ${buildMeaningfulAttachmentExistsSql("m")} as hasAttachments,
        EXISTS(SELECT 1 FROM attachments a WHERE a.messageId = m.id AND a.inline = 1)
          as hasInlineAttachments
      FROM messages m
      WHERE ${where}
      ORDER BY m.dateValue DESC
    `
    )
    .all(...args) as any[];
  const calendarUidMatchMessageIds =
    targetCalendarEventUidKeys.length === 0
      ? new Set<string>()
      : new Set(
          (
            db
              .prepare(
                `SELECT DISTINCT mce.messageId
                 FROM message_calendar_events mce
                 WHERE accountId = ?
                   AND ${buildCalendarEventUidMatchSql("mce")} IN (${targetCalendarEventUidKeys
                     .map(() => "?")
                     .join(",")})`
              )
              .all(accountId, ...targetCalendarEventUidKeys) as Array<{
                messageId?: string | null;
              }>
          )
            .map((row) => (row.messageId ?? "").trim())
            .filter(Boolean)
        );

  const targetParticipantSet = new Set(participantEmails);
  const targetRefSet = targetRefs;

  const scored = rows.map((row) => {
    if (row.id === target.id) {
      return { row, score: 1000 };
    }
    let score = 0;
    const candidateSubject = normalizeSubjectLine(row.subject);
    if (subjectNormalized && candidateSubject) {
      if (candidateSubject === subjectNormalized) {
        score += 6;
      } else if (
        candidateSubject.includes(subjectNormalized) ||
        subjectNormalized.includes(candidateSubject)
      ) {
        score += 4;
      } else if (subjectTokens.length > 0) {
        const tokens = new Set(
          candidateSubject.split(/\s+/).filter((token: string) => token.length > 2)
        );
        const overlap = subjectTokens.filter((token) => tokens.has(token)).length;
        score += Math.min(3, overlap);
      }
    }

    const candidateEmails = new Set(
      [
        ...extractEmailsFromText(row.fromAddr),
        ...extractEmailsFromText(row.toAddr),
        ...extractEmailsFromText(row.ccAddr),
        ...extractEmailsFromText(row.bccAddr)
      ]
    );
    let participantOverlap = 0;
    candidateEmails.forEach((email) => {
      if (targetParticipantSet.has(email)) participantOverlap += 1;
    });
    score += Math.min(5, participantOverlap) * 4;

    if (target.threadId && row.threadId === target.threadId) {
      score += 5;
    }
    if (row.messageId && targetRefSet.has(String(row.messageId).toLowerCase())) {
      score += 5;
    }
    if (row.inReplyTo && targetRefSet.has(String(row.inReplyTo).toLowerCase())) {
      score += 4;
    }
    const candidateRefs =
      parseReferences(row.references)?.map((ref) => ref.toLowerCase()) ?? [];
    if (candidateRefs.some((ref) => targetRefSet.has(ref))) {
      score += 3;
    }
    if (calendarUidMatchMessageIds.has(row.id)) {
      score += 18;
    }
    return { row, score };
  });

  const minScore = 4;
  const filtered = scored.filter((item) => item.row.id === target.id || item.score >= minScore);

  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.row.dateValue - a.row.dateValue;
  });

  const total = filtered.length;
  const start = Math.max(0, (page - 1) * pageSize);
  const pageRows = filtered.slice(start, start + pageSize).map((item) => item.row);
  const inviteDeckGroupsByMessageId =
    groupBy === INVITE_DECK_GROUP_BY
      ? await getInviteDeckGroupKeysByMessageId(
          db,
          accountId,
          filtered.map((item) => String(item.row.id ?? ""))
        )
      : new Map<string, string>();

  const items: Message[] = pageRows.map((row) => {
    const message: Message = {
      id: row.id,
      accountId: row.accountId,
      folderId: row.folderId,
      mailboxPath: row.mailboxPath ?? undefined,
      imapUid: typeof row.imapUid === "number" ? row.imapUid : undefined,
      threadId: row.threadId,
      parentId: row.parentId ?? undefined,
      messageId: row.messageId ?? undefined,
      inReplyTo: row.inReplyTo ?? undefined,
      references: parseReferences(row.references),
      xForwardedMessageId: row.xForwardedMessageId ?? undefined,
      xComposeFormat: row.xComposeFormat ?? undefined,
      quotedHtmlEdited: row.quotedHtmlEdited ? true : false,
      subject: row.subject,
      from: row.fromAddr,
      fromEmail: row.fromEmail ?? undefined,
      to: row.toAddr,
      cc: row.ccAddr ?? undefined,
      bcc: row.bccAddr ?? undefined,
      preview: row.preview,
      date: row.date,
      dateValue: row.dateValue,
      body: "",
      htmlBody: undefined,
      priority: row.priority ?? undefined,
      hasSource: Boolean(row.hasSource),
      hasAttachments: Boolean(row.hasAttachments),
      hasInlineAttachments: Boolean(row.hasInlineAttachments),
      attachments: [],
      unread: Boolean(row.unread),
      flags: row.flags ? (JSON.parse(row.flags) as string[]) : undefined,
      seen: Boolean(row.seen),
      answered: Boolean(row.answered),
      flagged: Boolean(row.flagged),
      deleted: Boolean(row.deleted),
      draft: Boolean(row.draft),
      recent: Boolean(row.recent),
      category: row.category ?? undefined,
      categoryScore: typeof row.categoryScore === "number" ? row.categoryScore : undefined,
      categorySignals: parseStringArray(row.categorySignals),
      listUnsubscribe: row.listUnsubscribe ?? undefined,
      listId: row.listId ?? undefined
    };
    (message as any).groupKey =
      inviteDeckGroupsByMessageId.get(message.id) ?? buildGroupKey(message, groupBy);
    return message;
  });

  const groupCounts = new Map<string, number>();
  filtered.forEach(({ row }) => {
    const message: Message = {
      id: row.id,
      accountId: row.accountId,
      folderId: row.folderId,
      threadId: row.threadId,
      subject: row.subject,
      from: row.fromAddr,
      fromEmail: row.fromEmail ?? undefined,
      to: row.toAddr,
      preview: row.preview,
      date: row.date,
      dateValue: row.dateValue,
      body: ""
    } as Message;
    const key = inviteDeckGroupsByMessageId.get(message.id) ?? buildGroupKey(message, groupBy);
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  });

  const groupRows = Array.from(groupCounts.entries()).map(([key, count]) => ({
    key,
    count
  }));
  if (groupBy === "date" || groupBy === INVITE_DECK_GROUP_BY) {
    groupRows.splice(0, groupRows.length, ...sortGroupsForGroupBy(groupRows, groupBy));
  } else if (groupBy === "week" || groupBy === "year") {
    groupRows.sort((a, b) => String(b.key).localeCompare(String(a.key)));
  } else {
    groupRows.sort((a, b) => b.count - a.count);
  }

  const groups = groupsFromRows(groupRows, groupBy);
  const hasMore = start + pageRows.length < total;

  return {
    items,
    groups,
    total,
    hasMore,
    baseCount: items.length,
    relatedSubject: target.subject ?? ""
  };
}

export async function listMessages(params: {
  accountId: string;
  folderId?: string | null;
  page: number;
  pageSize: number;
  query?: string | null;
  groupBy?: string;
  fields?: string[] | null;
  badges?: string[] | null;
  attachmentsOnly?: boolean;
  excludedFolderIds?: string[] | null;
}) {
  const {
    accountId,
    folderId,
    page,
    pageSize,
    query,
    groupBy = "date",
    fields,
    badges,
    attachmentsOnly,
    excludedFolderIds
  } = params;
  const db = await getAccountDb(accountId);
  const offset = (page - 1) * pageSize;
  const accountEmail = await getAccountEmail(accountId);

  const { ftsTokenQueries, fromTerms, toTerms, inTerms, inviteUidTerms, threadTerms, topicTerms, rawQuery, attachmentFilenameTerms } = parseSearchInput(
    query,
    fields,
    accountEmail
  );
  const hasInviteUidQuery = inviteUidTerms.length > 0;
  const baseWhere = `m.accountId = ? ${folderId ? "AND m.folderId = ?" : ""}`;
  const args: any[] = [accountId];
  if (folderId) args.push(folderId);
  let where = applyVisibleMessageFilters(baseWhere);

  // Apply "from:" filter
  fromTerms.forEach(() => {
    where += " AND lower(m.fromAddr) LIKE ?";
  });
  fromTerms.forEach((term) => args.push(`%${term.toLowerCase()}%`));

  // Apply "to:" filter (searches in To, Cc, and Bcc fields)
  toTerms.forEach(() => {
    where += " AND (lower(m.toAddr) LIKE ? OR lower(m.ccAddr) LIKE ? OR lower(m.bccAddr) LIKE ?)";
  });
  toTerms.forEach((term) => {
    const pattern = `%${term.toLowerCase()}%`;
    args.push(pattern, pattern, pattern);
  });

  // Apply "thread:" filter (exact thread ID match)
  threadTerms.forEach(() => {
    where += " AND m.threadId = ?";
  });
  threadTerms.forEach((term) => args.push(term));

  // Apply "topic:" filter (messages assigned to a topic)
  topicTerms.forEach((topicId) => {
    where += " AND EXISTS (SELECT 1 FROM thread_topics tt WHERE tt.threadId = m.threadId AND tt.topicId = ?)";
    args.push(topicId);
  });

  // Apply "in:" filter (searches in folder names)
  if (inTerms.length > 0) {
    const folderRows = db
      .prepare(
        `SELECT id FROM folders WHERE accountId = ? AND (${inTerms
          .map(() => "lower(name) LIKE ?")
          .join(" OR ")})`
      )
      .all(accountId, ...inTerms.map((term) => `%${term.toLowerCase()}%`)) as Array<{ id: string }>;
    const folderIds = folderRows.map((row) => row.id);
    if (folderIds.length > 0) {
      where += ` AND m.folderId IN (${folderIds.map(() => "?").join(",")})`;
      args.push(...folderIds);
    } else {
      // No matching folders, so no messages will match
      where += " AND 0 = 1";
    }
  }
  const searchQueryState = applySearchQueryFilters({
    where,
    args,
    ftsTokenQueries,
    rawQuery,
    attachmentFilenameTerms
  });
  where = searchQueryState.where;
  const hasQuery = searchQueryState.hasQuery;
  const hasIdQuery = searchQueryState.hasIdQuery;
  const hasAttachmentFilenameQuery = searchQueryState.hasAttachmentFilenameQuery;
  where = applyInviteUidQueryFilters({ where, args, accountId, inviteUidTerms });
  where = applyBadgeFilters(where, args, badges);
  where = applyExcludedFolderFilters(where, args, excludedFolderIds);
  const attachmentsFilter = attachmentsOnly ?? badges?.includes("attachments");
  if (attachmentsFilter) {
    where += ` AND ${buildMeaningfulAttachmentExistsSql("m")}`;
  }
  const shouldPrioritizeFlaggedMessages =
    !hasQuery &&
    !hasInviteUidQuery &&
    !hasIdQuery &&
    !hasAttachmentFilenameQuery &&
    fromTerms.length === 0 &&
    toTerms.length === 0 &&
    inTerms.length === 0 &&
    threadTerms.length === 0 &&
    (badges?.length ?? 0) === 0 &&
    !attachmentsFilter;
  const orderBySql = shouldPrioritizeFlaggedMessages
    ? "m.flagged DESC, m.dateValue DESC"
    : "m.dateValue DESC";
  const rows = db
    .prepare(
      `
      SELECT
        m.id,
        m.accountId,
        m.folderId,
        m.mailboxPath,
        m.imapUid,
        m.threadId,
        m.parentId,
        m.messageId,
        m.inReplyTo,
        m."references" as "references",
        m.xForwardedMessageId,
        m.xComposeFormat,
        m.quotedHtmlEdited,
        m.subject,
        m.fromAddr,
        m.toAddr,
        m.ccAddr,
        m.bccAddr,
        m.preview,
        m.date,
        m.dateValue,
        m.priority,
        m.hasSource,
        m.unread,
        m.flags,
        m.seen,
        m.answered,
        m.flagged,
        m.deleted,
        m.draft,
        m.recent,
        m.category,
        m.categoryScore,
        m.categorySignals,
        ${buildMeaningfulAttachmentExistsSql("m")} as hasAttachments,
        EXISTS(SELECT 1 FROM attachments a WHERE a.messageId = m.id AND a.inline = 1)
          as hasInlineAttachments
      FROM messages m
      WHERE ${where}
      ORDER BY ${orderBySql}
      LIMIT ? OFFSET ?
    `
    )
    .all(...args, pageSize, offset) as any[];
  const inviteDeckSummary =
    groupBy === INVITE_DECK_GROUP_BY
      ? await getInviteDeckGroupSummary({
          db,
          accountId,
          where,
          args
        })
      : null;
  const inviteDeckGroupsByMessageId =
    inviteDeckSummary?.groupsByMessageId ?? new Map<string, string>();

  const items: Message[] = rows.map((row) => {
    const message: Message = {
      id: row.id,
      accountId: row.accountId,
      folderId: row.folderId,
      mailboxPath: row.mailboxPath ?? undefined,
      imapUid: typeof row.imapUid === "number" ? row.imapUid : undefined,
      threadId: row.threadId,
      parentId: row.parentId ?? undefined,
      messageId: row.messageId ?? undefined,
      inReplyTo: row.inReplyTo ?? undefined,
      references: parseReferences(row.references),
      xForwardedMessageId: row.xForwardedMessageId ?? undefined,
      xComposeFormat: row.xComposeFormat ?? undefined,
      quotedHtmlEdited: row.quotedHtmlEdited ? true : false,
      subject: row.subject,
      from: row.fromAddr,
      fromEmail: row.fromEmail ?? undefined,
      to: row.toAddr,
      cc: row.ccAddr ?? undefined,
      bcc: row.bccAddr ?? undefined,
      preview: row.preview,
      date: row.date,
      dateValue: row.dateValue,
      body: "",
      htmlBody: undefined,
      priority: row.priority ?? undefined,
      hasSource: Boolean(row.hasSource),
      hasAttachments: Boolean(row.hasAttachments),
      hasInlineAttachments: Boolean(row.hasInlineAttachments),
      attachments: [],
      unread: Boolean(row.unread),
      flags: row.flags ? (JSON.parse(row.flags) as string[]) : undefined,
      seen: Boolean(row.seen),
      answered: Boolean(row.answered),
      flagged: Boolean(row.flagged),
      deleted: Boolean(row.deleted),
      draft: Boolean(row.draft),
      recent: Boolean(row.recent),
      category: row.category ?? undefined,
      categoryScore: typeof row.categoryScore === "number" ? row.categoryScore : undefined,
      categorySignals: parseStringArray(row.categorySignals),
      listUnsubscribe: row.listUnsubscribe ?? undefined,
      listId: row.listId ?? undefined
    };
    (message as any).groupKey =
      inviteDeckGroupsByMessageId.get(message.id) ?? buildGroupKey(message, groupBy);
    return message;
  });

  const groups =
    inviteDeckSummary?.groups ??
    (await getGroupCounts({
      accountId,
      folderId,
      query: query ?? undefined,
      groupBy,
      fields,
      badges,
      attachmentsOnly,
      excludedFolderIds
    }));
  const total =
    inviteDeckSummary?.total ??
    (await getTotalCount({
      accountId,
      folderId,
      query: query ?? undefined,
      fields,
      badges,
      attachmentsOnly,
      excludedFolderIds
    }));
  const hasMore = offset + items.length < total;
  return { items, groups, total, hasMore, baseCount: items.length };
}

export async function listThreads(params: {
  accountId: string;
  folderId?: string | null;
  page: number;
  pageSize: number;
  query?: string | null;
  groupBy?: string;
  threadDateSource?: ThreadDateSource;
  fields?: string[] | null;
  badges?: string[] | null;
  attachmentsOnly?: boolean;
  excludedFolderIds?: string[] | null;
}) {
  const {
    accountId,
    folderId,
    page,
    pageSize,
    query,
    groupBy = "date",
    threadDateSource = DEFAULT_THREAD_DATE_SOURCE,
    fields,
    badges,
    attachmentsOnly,
    excludedFolderIds
  } = params;
  const db = await getAccountDb(accountId);
  await ensureThreadLatestReceivedDateValues(db, accountId);
  const offset = (page - 1) * pageSize;
  const accountEmail = await getAccountEmail(accountId);
  const normalizedThreadDateSource = normalizeThreadDateSource(threadDateSource);
  const threadDateColumn = getThreadDateColumn(groupBy, normalizedThreadDateSource);

  const { ftsTokenQueries, fromTerms, toTerms, inTerms, inviteUidTerms, threadTerms, topicTerms, rawQuery, attachmentFilenameTerms } = parseSearchInput(
    query,
    fields,
    accountEmail
  );
  const hasInviteUidQuery = inviteUidTerms.length > 0;
  const baseWhere = `m.accountId = ? ${folderId ? "AND m.folderId = ?" : ""}`;
  const args: any[] = [accountId];
  if (folderId) args.push(folderId);
  let where = applyVisibleMessageFilters(baseWhere);

  // Apply "from:" filter
  fromTerms.forEach(() => {
    where += " AND lower(m.fromAddr) LIKE ?";
  });
  fromTerms.forEach((term) => args.push(`%${term.toLowerCase()}%`));

  // Apply "to:" filter (searches in To, Cc, and Bcc fields)
  toTerms.forEach(() => {
    where += " AND (lower(m.toAddr) LIKE ? OR lower(m.ccAddr) LIKE ? OR lower(m.bccAddr) LIKE ?)";
  });
  toTerms.forEach((term) => {
    const pattern = `%${term.toLowerCase()}%`;
    args.push(pattern, pattern, pattern);
  });

  // Apply "thread:" filter (exact thread ID match)
  threadTerms.forEach(() => {
    where += " AND m.threadId = ?";
  });
  threadTerms.forEach((term) => args.push(term));

  // Apply "topic:" filter (messages assigned to a topic)
  topicTerms.forEach((topicId) => {
    where += " AND EXISTS (SELECT 1 FROM thread_topics tt WHERE tt.threadId = m.threadId AND tt.topicId = ?)";
    args.push(topicId);
  });

  // Apply "in:" filter (searches in folder names)
  if (inTerms.length > 0) {
    const folderRows = db
      .prepare(
        `SELECT id FROM folders WHERE accountId = ? AND (${inTerms
          .map(() => "lower(name) LIKE ?")
          .join(" OR ")})`
      )
      .all(accountId, ...inTerms.map((term) => `%${term.toLowerCase()}%`)) as Array<{ id: string }>;
    const folderIds = folderRows.map((row) => row.id);
    if (folderIds.length > 0) {
      where += ` AND m.folderId IN (${folderIds.map(() => "?").join(",")})`;
      args.push(...folderIds);
    } else {
      // No matching folders, so no messages will match
      where += " AND 0 = 1";
    }
  }
  const searchQueryState = applySearchQueryFilters({
    where,
    args,
    ftsTokenQueries,
    rawQuery,
    attachmentFilenameTerms
  });
  where = searchQueryState.where;
  const hasQuery = searchQueryState.hasQuery;
  const hasIdQuery = searchQueryState.hasIdQuery;
  const hasAttachmentFilenameQuery = searchQueryState.hasAttachmentFilenameQuery;
  where = applyInviteUidQueryFilters({ where, args, accountId, inviteUidTerms });
  where = applyBadgeFilters(where, args, badges);
  where = applyExcludedFolderFilters(where, args, excludedFolderIds);
  const attachmentsFilter = attachmentsOnly ?? badges?.includes("attachments");
  if (attachmentsFilter) {
    where += ` AND ${buildMeaningfulAttachmentExistsSql("m")}`;
  }

  const normalizedExcludedFolderIds = Array.from(
    new Set((excludedFolderIds ?? []).map((value) => value.trim()).filter(Boolean))
  );
  const shouldPrioritizeFlaggedThreads =
    !hasQuery &&
    !hasInviteUidQuery &&
    !hasIdQuery &&
    !hasAttachmentFilenameQuery &&
    fromTerms.length === 0 &&
    toTerms.length === 0 &&
    inTerms.length === 0 &&
    threadTerms.length === 0 &&
    (badges?.length ?? 0) === 0 &&
    !attachmentsFilter;
  const isUnfilteredThreadList =
    !folderId &&
    !hasQuery &&
    !hasInviteUidQuery &&
    !hasIdQuery &&
    !hasAttachmentFilenameQuery &&
    fromTerms.length === 0 &&
    toTerms.length === 0 &&
    inTerms.length === 0 &&
    threadTerms.length === 0 &&
    (badges?.length ?? 0) === 0 &&
    !attachmentsFilter &&
    normalizedExcludedFolderIds.length === 0;

  let threadRows: any[] = [];
  let threadTotal = 0;
  let total = 0;
  let baseCount = 0;
  const inviteDeckSummaryPromise =
    groupBy === INVITE_DECK_GROUP_BY
      ? getInviteDeckGroupSummary({
          db,
          accountId,
          where,
          args
        })
      : null;

  if (isUnfilteredThreadList) {
    if (shouldPrioritizeFlaggedThreads) {
      threadRows = db
        .prepare(
          `
          SELECT t.*, t.${threadDateColumn} as effectiveThreadDateValue
          FROM threads t
          LEFT JOIN (
            SELECT DISTINCT m.threadId
            FROM messages m
            WHERE m.accountId = ? AND m.flagged = 1 AND COALESCE(m.deleted, 0) = 0
          ) flaggedThreads
            ON flaggedThreads.threadId = t.threadId
          WHERE t.accountId = ?
            AND EXISTS (
              SELECT 1
              FROM messages m
              WHERE m.accountId = t.accountId
                AND m.threadId = t.threadId
                AND COALESCE(m.deleted, 0) = 0
            )
          ORDER BY
            CASE WHEN flaggedThreads.threadId IS NULL THEN 0 ELSE 1 END DESC,
            t.${threadDateColumn} DESC
          LIMIT ? OFFSET ?
        `
        )
        .all(accountId, accountId, pageSize, offset) as any[];
    } else {
      threadRows = db
        .prepare(
          `
          SELECT t.*, t.${threadDateColumn} as effectiveThreadDateValue
          FROM threads t
          WHERE t.accountId = ?
            AND EXISTS (
              SELECT 1
              FROM messages m
              WHERE m.accountId = t.accountId
                AND m.threadId = t.threadId
                AND COALESCE(m.deleted, 0) = 0
            )
          ORDER BY t.${threadDateColumn} DESC
          LIMIT ? OFFSET ?
        `
        )
        .all(accountId, pageSize, offset) as any[];
    }

    const threadTotalRow = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM threads t
         WHERE t.accountId = ?
           AND EXISTS (
             SELECT 1
             FROM messages m
             WHERE m.accountId = t.accountId
               AND m.threadId = t.threadId
               AND COALESCE(m.deleted, 0) = 0
           )`
      )
      .get(accountId) as { count: number } | undefined;
    threadTotal = threadTotalRow?.count ?? 0;

    const totalRow = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM messages m
         WHERE m.accountId = ? AND COALESCE(m.deleted, 0) = 0`
      )
      .get(accountId) as { count: number } | undefined;
    total = totalRow?.count ?? 0;
    const threadIdsForBaseCount = threadRows.map((row) => row.threadId);
    const baseCountRow =
      threadIdsForBaseCount.length > 0
        ? (db
            .prepare(
              `SELECT COUNT(*) as count
               FROM messages m
               WHERE m.accountId = ?
                 AND COALESCE(m.deleted, 0) = 0
                 AND m.threadId IN (${threadIdsForBaseCount.map(() => "?").join(",")})`
            )
            .get(accountId, ...threadIdsForBaseCount) as { count: number })
        : { count: 0 };
    baseCount = baseCountRow?.count ?? 0;
  } else {
    const threadFilterSql = `SELECT DISTINCT m.threadId FROM messages m WHERE ${where}`;
    const flaggedOrderArgs: any[] = [];
    let flaggedJoinSql = "";
    let threadOrderSql = `t.${threadDateColumn} DESC`;
    if (shouldPrioritizeFlaggedThreads) {
      let flaggedWhere = "mf.accountId = ? AND mf.flagged = 1";
      flaggedOrderArgs.push(accountId);
      flaggedWhere = applyVisibleMessageFilters(flaggedWhere, "mf");
      flaggedWhere = applyExcludedFolderFilters(
        flaggedWhere,
        flaggedOrderArgs,
        excludedFolderIds,
        "mf"
      );
      flaggedJoinSql = `
        LEFT JOIN (
          SELECT DISTINCT mf.threadId
          FROM messages mf
          WHERE ${flaggedWhere}
        ) flaggedThreads
          ON flaggedThreads.threadId = t.threadId
      `;
      threadOrderSql =
        `CASE WHEN flaggedThreads.threadId IS NULL THEN 0 ELSE 1 END DESC, t.${threadDateColumn} DESC`;
    }

    threadRows = db
      .prepare(
        `
        SELECT t.*, t.${threadDateColumn} as effectiveThreadDateValue
        FROM threads t
        ${flaggedJoinSql}
        WHERE t.accountId = ?
          AND t.threadId IN (${threadFilterSql})
        ORDER BY ${threadOrderSql}
        LIMIT ? OFFSET ?
      `
      )
      .all(...flaggedOrderArgs, accountId, ...args, pageSize, offset) as any[];

    const threadTotalRow = db
      .prepare(
        `
        SELECT COUNT(*) as count
        FROM threads t
        WHERE t.accountId = ?
          AND t.threadId IN (${threadFilterSql})
      `
      )
      .get(accountId, ...args) as { count: number };
    threadTotal = threadTotalRow?.count ?? 0;

    if (groupBy !== INVITE_DECK_GROUP_BY) {
      total = await getTotalCount({
        accountId,
        folderId,
        query: query ?? undefined,
        fields,
        badges,
        attachmentsOnly,
        excludedFolderIds
      });
    }

    const threadIdsForBaseCount = threadRows.map((row) => row.threadId);
    const baseCountRow =
      threadIdsForBaseCount.length > 0
        ? (db
            .prepare(
              `
              SELECT COUNT(*) as count
              FROM messages m
              WHERE ${where}
                AND m.threadId IN (${threadIdsForBaseCount.map(() => "?").join(",")})
            `
            )
            .get(...args, ...threadIdsForBaseCount) as { count: number })
        : { count: 0 };
    baseCount = baseCountRow?.count ?? 0;
  }

  const threadIds = threadRows.map((row) => row.threadId);
  const threadDateValueByThreadId = new Map<string, number>();
  threadRows.forEach((row) => {
    const value =
      typeof row.effectiveThreadDateValue === "number" && Number.isFinite(row.effectiveThreadDateValue)
        ? row.effectiveThreadDateValue
        : typeof row[threadDateColumn] === "number" && Number.isFinite(row[threadDateColumn])
          ? row[threadDateColumn]
          : typeof row.latestDateValue === "number" && Number.isFinite(row.latestDateValue)
            ? row.latestDateValue
            : 0;
    threadDateValueByThreadId.set(row.threadId, value);
  });

  const threadMessageArgs: any[] = [accountId];
  let threadMessageWhere = applyVisibleMessageFilters("m.accountId = ?");
  threadMessageWhere = applyExcludedFolderFilters(
    threadMessageWhere,
    threadMessageArgs,
    excludedFolderIds
  );

  const messagesRows =
    threadIds.length > 0
      ? (db
          .prepare(
            `
            SELECT
              m.id,
              m.accountId,
              m.folderId,
              m.mailboxPath,
              m.imapUid,
              m.threadId,
              m.parentId,
              m.messageId,
              m.inReplyTo,
              m."references" as "references",
              m.xForwardedMessageId,
              m.subject,
              m.fromAddr,
              m.toAddr,
              m.ccAddr,
              m.bccAddr,
              m.preview,
              m.date,
              m.dateValue,
              m.priority,
              m.hasSource,
              m.unread,
              m.flags,
              m.seen,
              m.answered,
              m.flagged,
              m.deleted,
              m.draft,
              m.recent,
              m.category,
              m.categoryScore,
              m.categorySignals,
              ${buildMeaningfulAttachmentExistsSql("m")} as hasAttachments,
              EXISTS(SELECT 1 FROM attachments a WHERE a.messageId = m.id AND a.inline = 1)
                as hasInlineAttachments
            FROM messages m
            WHERE ${threadMessageWhere}
              AND m.threadId IN (${threadIds.map(() => "?").join(",")})
            ORDER BY m.dateValue DESC
          `
          )
          .all(...threadMessageArgs, ...threadIds) as any[])
      : [];
  const inviteDeckSummary = inviteDeckSummaryPromise
    ? await inviteDeckSummaryPromise
    : null;
  const inviteDeckThreadGroupsByMessageId =
    groupBy === INVITE_DECK_GROUP_BY
      ? await getInviteDeckGroupKeysByMessageId(
          db,
          accountId,
          messagesRows.map((row) => String(row.id ?? ""))
        )
      : new Map<string, string>();

  const items: Message[] = messagesRows.map((row) => {
    const message: Message = {
      id: row.id,
      accountId: row.accountId,
      folderId: row.folderId,
      mailboxPath: row.mailboxPath ?? undefined,
      imapUid: typeof row.imapUid === "number" ? row.imapUid : undefined,
      threadId: row.threadId,
      parentId: row.parentId ?? undefined,
      messageId: row.messageId ?? undefined,
      inReplyTo: row.inReplyTo ?? undefined,
      references: parseReferences(row.references),
      xForwardedMessageId: row.xForwardedMessageId ?? undefined,
      xComposeFormat: row.xComposeFormat ?? undefined,
      quotedHtmlEdited: row.quotedHtmlEdited ? true : false,
      subject: row.subject,
      from: row.fromAddr,
      fromEmail: row.fromEmail ?? undefined,
      to: row.toAddr,
      cc: row.ccAddr ?? undefined,
      bcc: row.bccAddr ?? undefined,
      preview: row.preview,
      date: row.date,
      dateValue: row.dateValue,
      body: "",
      htmlBody: undefined,
      priority: row.priority ?? undefined,
      hasSource: Boolean(row.hasSource),
      hasAttachments: Boolean(row.hasAttachments),
      hasInlineAttachments: Boolean(row.hasInlineAttachments),
      attachments: [],
      unread: Boolean(row.unread),
      flags: row.flags ? (JSON.parse(row.flags) as string[]) : undefined,
      seen: Boolean(row.seen),
      answered: Boolean(row.answered),
      flagged: Boolean(row.flagged),
      deleted: Boolean(row.deleted),
      draft: Boolean(row.draft),
      recent: Boolean(row.recent),
      category: row.category ?? undefined,
      categoryScore: typeof row.categoryScore === "number" ? row.categoryScore : undefined,
      categorySignals: parseStringArray(row.categorySignals),
      listUnsubscribe: row.listUnsubscribe ?? undefined,
      listId: row.listId ?? undefined
    };
    const threadDateValue = threadDateValueByThreadId.get(message.threadId);
    message.threadSortDateValue = threadDateValue ?? message.dateValue;
    (message as any).groupKey =
      inviteDeckThreadGroupsByMessageId.get(message.id) ??
      buildGroupKey(
        message,
        groupBy,
        isThreadDateSensitiveGroupBy(groupBy) ? threadDateValue : undefined
      );
    return message;
  });

  const groups =
    inviteDeckSummary?.groups ??
    (await (isThreadDateSensitiveGroupBy(groupBy)
      ? getThreadGroupCounts({
          db,
          accountId,
          where,
          args,
          groupBy,
          threadDateColumn
        })
      : getGroupCounts({
          accountId,
          folderId,
          query: query ?? undefined,
          groupBy,
          fields,
          badges,
          attachmentsOnly,
          excludedFolderIds
        })));

  const hasMore = offset + threadRows.length < threadTotal;
  return { items, groups, total: inviteDeckSummary?.total ?? total, hasMore, baseCount };
}

export async function listThreadMessages(params: {
  accountId: string;
  threadIds: string[];
  messageIds?: string[];
  groupBy?: string;
  threadDateSource?: ThreadDateSource;
}) {
  const {
    accountId,
    threadIds,
    messageIds = [],
    groupBy = "date",
    threadDateSource = DEFAULT_THREAD_DATE_SOURCE
  } = params;
  const uniqueThreads = Array.from(new Set(threadIds.filter(Boolean)));
  const uniqueMessages = Array.from(new Set(messageIds.filter(Boolean)));
  if (uniqueThreads.length === 0 && uniqueMessages.length === 0) {
    return { items: [] as Message[] };
  }
  const db = await getAccountDb(accountId);
  const normalizedThreadDateSource = normalizeThreadDateSource(threadDateSource);
  const threadDateColumn = getThreadDateColumn(groupBy, normalizedThreadDateSource);
  const clauses: string[] = [];
  const args: any[] = [accountId];
  if (uniqueThreads.length > 0) {
    clauses.push(`m.threadId IN (${uniqueThreads.map(() => "?").join(",")})`);
    args.push(...uniqueThreads);
  }
  if (uniqueMessages.length > 0) {
    clauses.push(`m.id IN (${uniqueMessages.map(() => "?").join(",")})`);
    args.push(...uniqueMessages);
  }
  const rows = db
    .prepare(
      `
      SELECT DISTINCT m.*
      FROM messages m
      WHERE m.accountId = ? AND (${clauses.join(" OR ")}) AND COALESCE(m.deleted, 0) = 0
    `
    )
    .all(...args) as any[];
  const rowThreadIds = Array.from(
    new Set(
      rows
        .map((row) => String(row.threadId ?? "").trim())
        .filter(Boolean)
    )
  );
  const threadDateValueByThreadId =
    rowThreadIds.length > 0
      ? new Map(
          (
            db
              .prepare(
                `
                SELECT threadId, ${threadDateColumn} as threadDateValue, latestDateValue
                FROM threads
                WHERE accountId = ? AND threadId IN (${rowThreadIds.map(() => "?").join(",")})
              `
              )
              .all(accountId, ...rowThreadIds) as Array<{
              threadId?: string | null;
              threadDateValue?: number | null;
              latestDateValue?: number | null;
            }>
          )
            .flatMap((row): Array<[string, number]> => {
              const threadId = String(row.threadId ?? "").trim();
              if (!threadId) return [];
              const threadDateValue = Number.isFinite(Number(row.threadDateValue))
                ? Number(row.threadDateValue)
                : Number.isFinite(Number(row.latestDateValue))
                  ? Number(row.latestDateValue)
                  : 0;
              return [[threadId, threadDateValue]];
            })
        )
      : new Map<string, number>();

  const ids = rows.map((row) => row.id);
  const attachmentRows =
    ids.length > 0
      ? (db
          .prepare(
            `SELECT * FROM attachments WHERE messageId IN (${ids.map(() => "?").join(",")})`
          )
          .all(...ids) as any[])
      : [];
  const inviteDeckThreadMessageGroupsByMessageId =
    groupBy === INVITE_DECK_GROUP_BY
      ? await getInviteDeckGroupKeysByMessageId(db, accountId, ids)
      : new Map<string, string>();

  const attachmentsByMessage = new Map<string, Attachment[]>();
  attachmentRows.forEach((row) => {
    const list = attachmentsByMessage.get(row.messageId) ?? [];
    list.push({
      id: row.id,
      filename: row.filename,
      contentType: row.contentType,
      size: row.size,
      inline: Boolean(row.inline),
      cid: row.cid ?? undefined,
      url: row.url ?? undefined
    });
    attachmentsByMessage.set(row.messageId, list);
  });

  const items: Message[] = rows.map((row) => {
    const message: Message = {
      id: row.id,
      accountId: row.accountId,
      folderId: row.folderId,
      mailboxPath: row.mailboxPath ?? undefined,
      imapUid: typeof row.imapUid === "number" ? row.imapUid : undefined,
      threadId: row.threadId,
      parentId: row.parentId ?? undefined,
      messageId: row.messageId ?? undefined,
      inReplyTo: row.inReplyTo ?? undefined,
      references: parseReferences(row.references),
      xForwardedMessageId: row.xForwardedMessageId ?? undefined,
      xComposeFormat: row.xComposeFormat ?? undefined,
      quotedHtmlEdited: row.quotedHtmlEdited ? true : false,
      subject: row.subject,
      from: row.fromAddr,
      fromEmail: row.fromEmail ?? undefined,
      to: row.toAddr,
      cc: row.ccAddr ?? undefined,
      bcc: row.bccAddr ?? undefined,
      preview: row.preview,
      date: row.date,
      dateValue: row.dateValue,
      body: row.body,
      htmlBody: row.htmlBody ?? undefined,
      priority: row.priority ?? undefined,
      hasSource: Boolean(row.hasSource),
      attachments: attachmentsByMessage.get(row.id) ?? [],
      unread: Boolean(row.unread),
      flags: row.flags ? (JSON.parse(row.flags) as string[]) : undefined,
      seen: Boolean(row.seen),
      answered: Boolean(row.answered),
      flagged: Boolean(row.flagged),
      deleted: Boolean(row.deleted),
      draft: Boolean(row.draft),
      recent: Boolean(row.recent),
      category: row.category ?? undefined,
      categoryScore: typeof row.categoryScore === "number" ? row.categoryScore : undefined,
      categorySignals: parseStringArray(row.categorySignals),
      listUnsubscribe: row.listUnsubscribe ?? undefined,
      listId: row.listId ?? undefined
    };
    const threadDateValue = threadDateValueByThreadId.get(message.threadId);
    message.threadSortDateValue = threadDateValue ?? message.dateValue;
    (message as any).groupKey =
      inviteDeckThreadMessageGroupsByMessageId.get(message.id) ??
      buildGroupKey(
        message,
        groupBy,
        isThreadDateSensitiveGroupBy(groupBy) ? threadDateValue : undefined
      );
    return message;
  });

  return { items };
}

export async function getThreadIdsByMessageIds(accountId: string, messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, string>();
  const db = await getAccountDb(accountId);
  const requestedIds = Array.from(new Set(messageIds.map((value) => value.trim()).filter(Boolean)));
  if (requestedIds.length === 0) return new Map<string, string>();
  const rows = db
    .prepare(
      `SELECT messageId, threadId, dateValue, id
       FROM messages
       WHERE accountId = ?
         AND (
           messageId IN (${requestedIds.map(() => "?").join(",")})
           OR threadId IN (${requestedIds.map(() => "?").join(",")})
         )
       ORDER BY dateValue ASC, id ASC`
    )
    .all(accountId, ...requestedIds, ...requestedIds) as Array<{
    messageId: string | null;
    threadId: string | null;
    dateValue: number;
    id: string;
  }>;
  const map = new Map<string, string>();
  const requestedIdSet = new Set(requestedIds);
  rows.forEach((row) => {
    // The same Message-ID may appear in multiple folders. Use the oldest copy
    // as the canonical external thread mapping to keep sync-time threading stable.
    if (
      row.messageId &&
      row.threadId &&
      requestedIdSet.has(row.messageId) &&
      !map.has(row.messageId)
    ) {
      map.set(row.messageId, row.threadId);
    }
    if (
      row.threadId &&
      requestedIdSet.has(row.threadId) &&
      !map.has(row.threadId)
    ) {
      map.set(row.threadId, row.threadId);
    }
  });
  return map;
}

export async function getMessageIdsByMessageIds(accountId: string, messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, string>();
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT messageId, id, dateValue
       FROM messages
       WHERE accountId = ? AND messageId IN (${messageIds.map(() => "?").join(",")})
       ORDER BY dateValue ASC`
    )
    .all(accountId, ...messageIds) as Array<{
    messageId: string | null;
    id: string;
    dateValue: number;
  }>;
  const map = new Map<string, string>();
  rows.forEach((row) => {
    if (row.messageId && row.id && !map.has(row.messageId)) {
      map.set(row.messageId, row.id);
    }
  });
  return map;
}

export async function getFolderIdsByMessageIds(accountId: string, messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, string>();
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT id, folderId
       FROM messages
       WHERE accountId = ? AND id IN (${messageIds.map(() => "?").join(",")})`
    )
    .all(accountId, ...messageIds) as Array<{
    id: string;
    folderId: string;
  }>;
  const map = new Map<string, string>();
  rows.forEach((row) => {
    if (row.id && row.folderId) {
      map.set(row.id, row.folderId);
    }
  });
  return map;
}

export async function getThreadMessageIdsForMove(params: {
  accountId: string;
  threadId: string;
  sourceFolderId?: string | null;
  excludedFolderIds?: string[];
}) {
  const { accountId, threadId, sourceFolderId, excludedFolderIds = [] } = params;
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) return [] as string[];
  const uniqueExcludedFolderIds = Array.from(
    new Set(excludedFolderIds.map((folderId) => folderId.trim()).filter(Boolean))
  );
  const db = await getAccountDb(accountId);
  const clauses = [
    "accountId = ?",
    "threadId = ?",
    "COALESCE(deleted, 0) = 0"
  ];
  const args: Array<string> = [accountId, normalizedThreadId];
  if (sourceFolderId?.trim()) {
    clauses.push("folderId = ?");
    args.push(sourceFolderId.trim());
  }
  if (uniqueExcludedFolderIds.length > 0) {
    clauses.push(`folderId NOT IN (${uniqueExcludedFolderIds.map(() => "?").join(",")})`);
    args.push(...uniqueExcludedFolderIds);
  }
  const rows = db
    .prepare(
      `SELECT id
       FROM messages
       WHERE ${clauses.join(" AND ")}
       ORDER BY dateValue ASC, id ASC`
    )
    .all(...args) as Array<{ id?: string | null }>;
  return rows
    .map((row) => String(row.id ?? "").trim())
    .filter(Boolean);
}

export async function upsertMessages(
  accountId: string,
  folderId: string | null,
  nextMessages: Message[],
  replaceExisting = false,
  options: { recomputeThreads?: boolean } = {}
) {
  return withDbWriteRetry("upsertMessages", async () => {
    const { moveMessageFiles } = await import("./storage");
    const shouldRecomputeThreads = options.recomputeThreads ?? true;
    const UPSERT_BATCH_SIZE = 200;
    const yieldToEventLoop = () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    const db = await getAccountDb(accountId);
    const deleteSql = folderId
      ? `DELETE FROM messages WHERE accountId = ? AND folderId = ?`
      : `DELETE FROM messages WHERE accountId = ?`;
    const deleteArgs = folderId ? [accountId, folderId] : [accountId];
    const deleteAttachmentsByScope = folderId
      ? db.prepare(
          `DELETE FROM attachments WHERE messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId = ?)`
        )
      : db.prepare(
          `DELETE FROM attachments WHERE messageId IN (SELECT id FROM messages WHERE accountId = ?)`
        );
    const deleteCalendarEventsByScope = folderId
      ? db.prepare(
          `DELETE FROM message_calendar_events
           WHERE accountId = ?
             AND messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId = ?)`
        )
      : db.prepare(`DELETE FROM message_calendar_events WHERE accountId = ?`);
    const deleteAttachmentsForMessage = db.prepare(
      `DELETE FROM attachments WHERE messageId = ?`
    );
    const deleteCalendarEventsForMessage = db.prepare(
      `DELETE FROM message_calendar_events WHERE accountId = ? AND messageId = ?`
    );
    const selectCalendarEventsForMessage = db.prepare(
      `SELECT
         eventUid,
         eventUidKey,
         eventFirstStartAtMs,
         eventLastEndAtMs,
         inviteActionType,
         processedAtMs,
         processedByUserId
       FROM message_calendar_events
       WHERE accountId = ? AND messageId = ?`
    );
    const deleteMessageById = db.prepare(`DELETE FROM messages WHERE accountId = ? AND id = ?`);
    const findMessageById = db.prepare(
      `SELECT id, folderId, mailboxPath, imapUid
       FROM messages
       WHERE accountId = ? AND id = ?`
    );
    const findFolderMessageDuplicates = db.prepare(
      `SELECT id, threadId
       FROM messages
       WHERE accountId = ? AND folderId = ? AND messageId = ? AND id <> ?`
    );
    const deleteFtsByScope = folderId
      ? db.prepare(
          `DELETE FROM message_fts WHERE messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId = ?)`
        )
      : db.prepare(
          `DELETE FROM message_fts WHERE messageId IN (SELECT id FROM messages WHERE accountId = ?)`
        );
    const insertAttachment = db.prepare(
      `INSERT OR REPLACE INTO attachments (id, messageId, filename, contentType, size, inline, cid, url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertCalendarEvent = db.prepare(
      `INSERT OR REPLACE INTO message_calendar_events (
         accountId,
         messageId,
         eventUid,
         eventUidKey,
         eventFirstStartAtMs,
         eventLastEndAtMs,
         inviteActionType,
         processedAtMs,
         processedByUserId
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertMessage = db.prepare(`
      INSERT OR REPLACE INTO messages (
        id, accountId, folderId, threadId, parentId, messageId, inReplyTo, "references", xForwardedMessageId, xComposeFormat, quotedHtmlEdited,
        subject, fromAddr, fromEmail, toAddr, ccAddr, bccAddr, mailboxPath, imapUid, preview, date, dateValue,
        body, htmlBody, priority, hasSource, unread, flags, seen, answered, flagged, deleted, draft, recent,
        category, categoryScore, categorySignals, categoryManualState, listUnsubscribe, listId
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare(`
      INSERT INTO message_fts (messageId, subject, fromAddr, toAddr, ccAddr, bccAddr, body, preview)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteFts = db.prepare(`DELETE FROM message_fts WHERE messageId = ?`);
    const deleteMessages = db.prepare(deleteSql);
    const existingScopeThreadIds =
      replaceExisting && folderId
        ? new Set(
            (
              db
                .prepare(
                  `SELECT DISTINCT threadId
                   FROM messages
                   WHERE accountId = ? AND folderId = ?`
                )
                .all(accountId, folderId) as Array<{ threadId: string | null }>
            )
              .map((row) => row.threadId)
              .filter((id): id is string => Boolean(id))
          )
        : null;
    const existingAccountThreadIds =
      replaceExisting && !folderId
        ? new Set(
            (
              db
                .prepare(
                  `SELECT DISTINCT threadId
                   FROM messages
                   WHERE accountId = ?`
                )
                .all(accountId) as Array<{ threadId: string | null }>
            )
              .map((row) => row.threadId)
              .filter((id): id is string => Boolean(id))
          )
        : null;
    const manualCategoryStateByMessageId = new Map<string, CategoryManualState>();
    const rememberManualCategoryState = (rows: Array<{ id?: string | null; categoryManualState?: string | null }>) => {
      rows.forEach((row) => {
        const id = (row.id ?? "").trim();
        if (!id) return;
        const manualState = normalizeCategoryManualState(row.categoryManualState);
        if (manualState) {
          manualCategoryStateByMessageId.set(id, manualState);
        }
      });
    };
    const loadManualCategoryStatesForMessageIds = (messageIds: string[]) => {
      const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
      if (uniqueIds.length === 0) return;
      const QUERY_BATCH_SIZE = 400;
      for (let start = 0; start < uniqueIds.length; start += QUERY_BATCH_SIZE) {
        const chunk = uniqueIds.slice(start, start + QUERY_BATCH_SIZE);
        if (chunk.length === 0) continue;
        const rows = db
          .prepare(
            `SELECT id, categoryManualState
             FROM messages
             WHERE accountId = ?
               AND categoryManualState IS NOT NULL
               AND id IN (${chunk.map(() => "?").join(",")})`
          )
          .all(accountId, ...chunk) as Array<{ id?: string | null; categoryManualState?: string | null }>;
        rememberManualCategoryState(rows);
      }
    };
    if (replaceExisting) {
      const rows = (folderId
        ? db
            .prepare(
              `SELECT id, categoryManualState
               FROM messages
               WHERE accountId = ? AND folderId = ? AND categoryManualState IS NOT NULL`
            )
            .all(accountId, folderId)
        : db
            .prepare(
              `SELECT id, categoryManualState
               FROM messages
               WHERE accountId = ? AND categoryManualState IS NOT NULL`
            )
            .all(accountId)) as Array<{ id?: string | null; categoryManualState?: string | null }>;
      rememberManualCategoryState(rows);
    } else {
      loadManualCategoryStatesForMessageIds(nextMessages.map((message) => message.id));
    }
    const dedupedThreadIds = new Set<string>();
    const upsertBatch = db.transaction(
      (batch: Message[], shouldDeleteAttachments: boolean): UpsertFileMove[] => {
      const fileMoves: UpsertFileMove[] = [];
      batch.forEach((message) => {
        let rowId = message.id;
        const existingById = findMessageById.get(accountId, rowId) as
          | { id: string; folderId?: string | null; mailboxPath?: string | null; imapUid?: number | null }
          | undefined;
        if (existingById && !isSameMailboxMessageCopy(existingById, message)) {
          rowId = buildMessageCollisionVariantId(
            message.id,
            message.mailboxPath ?? message.folderId,
            message.imapUid ?? null
          );
          const attachmentIds = Array.from(
            new Set((message.attachments ?? []).map((attachment) => attachment.id).filter(Boolean))
          );
          fileMoves.push({
            previousMessageId: message.id,
            nextMessageId: rowId,
            attachmentIds
          });
        }
        if (message.messageId) {
          const duplicates = findFolderMessageDuplicates.all(
            accountId,
            message.folderId,
            message.messageId,
            rowId
          ) as Array<{ id: string; threadId: string | null }>;
          duplicates.forEach((row) => {
            deleteAttachmentsForMessage.run(row.id);
            deleteCalendarEventsForMessage.run(accountId, row.id);
            deleteFts.run(row.id);
            deleteMessageById.run(accountId, row.id);
            if (row.threadId) {
              dedupedThreadIds.add(row.threadId);
            }
          });
        }
        if (shouldDeleteAttachments) {
          deleteAttachmentsForMessage.run(rowId);
        }
        const preservedCalendarInviteStateByUid = new Map(
          (
            selectCalendarEventsForMessage.all(accountId, rowId) as Array<{
              eventUid?: string | null;
              eventUidKey?: string | null;
              eventFirstStartAtMs?: number | null;
              eventLastEndAtMs?: number | null;
              inviteActionType?: string | null;
              processedAtMs?: number | null;
              processedByUserId?: string | null;
            }>
          )
            .map((row) => {
              const eventUid = normalizeCalendarEventUid(row.eventUid);
              if (!eventUid) return null;
              return [
                eventUid,
                {
                  eventUidKey:
                    typeof row.eventUidKey === "string" && row.eventUidKey.trim()
                      ? row.eventUidKey.trim()
                      : normalizeCalendarEventUidKey(eventUid),
                  eventFirstStartAtMs:
                    typeof row.eventFirstStartAtMs === "number" &&
                    Number.isFinite(row.eventFirstStartAtMs) &&
                    row.eventFirstStartAtMs > 0
                      ? row.eventFirstStartAtMs
                      : null,
                  eventLastEndAtMs:
                    row.eventLastEndAtMs === null || row.eventLastEndAtMs === undefined
                      ? null
                      : typeof row.eventLastEndAtMs === "number" &&
                          Number.isFinite(row.eventLastEndAtMs) &&
                          row.eventLastEndAtMs > 0
                        ? row.eventLastEndAtMs
                        : null,
                  inviteActionType: row.inviteActionType ?? null,
                  processedAtMs:
                    typeof row.processedAtMs === "number" && Number.isFinite(row.processedAtMs)
                      ? row.processedAtMs
                      : null,
                  processedByUserId:
                    typeof row.processedByUserId === "string" && row.processedByUserId.trim()
                      ? row.processedByUserId.trim()
                      : null
                }
              ] as const;
            })
            .filter(
              (
                entry
              ): entry is readonly [
                string,
                {
                  eventUidKey: string | null;
                  eventFirstStartAtMs: number | null;
                  eventLastEndAtMs: number | null;
                  inviteActionType: string | null;
                  processedAtMs: number | null;
                  processedByUserId: string | null;
                }
              ] => Boolean(entry)
            )
        );
        deleteCalendarEventsForMessage.run(accountId, rowId);
        const normalizedFlags = normalizeImapFlags(message.flags);
        const hasRawFlags = Array.isArray(message.flags);
        const normalizedSystemFlags = deriveSystemFlagState(normalizedFlags);
        const seen = hasRawFlags ? Boolean(normalizedSystemFlags.seen) : Boolean(message.seen);
        const answered = hasRawFlags
          ? Boolean(normalizedSystemFlags.answered)
          : Boolean(message.answered);
        const flagged = hasRawFlags
          ? Boolean(normalizedSystemFlags.flagged)
          : Boolean(message.flagged);
        const deleted = hasRawFlags ? Boolean(normalizedSystemFlags.deleted) : Boolean(message.deleted);
        const draft = hasRawFlags ? Boolean(normalizedSystemFlags.draft) : Boolean(message.draft);
        const recent = hasRawFlags ? Boolean(normalizedSystemFlags.recent) : Boolean(message.recent);
        const unread = hasRawFlags
          ? Boolean(normalizedSystemFlags.unread)
          : typeof message.unread === "boolean"
            ? message.unread
            : !seen;
        const manualCategoryState =
          manualCategoryStateByMessageId.get(rowId) ??
          manualCategoryStateByMessageId.get(message.id) ??
          null;
        const category =
          manualCategoryState === "cleared" ? null : normalizeCategory(message.category) ?? null;
        const categoryScore =
          manualCategoryState === "cleared"
            ? null
            : typeof message.categoryScore === "number"
              ? message.categoryScore
              : null;
        const categorySignals =
          manualCategoryState === "cleared"
            ? ["manual-category:cleared", "manual-feedback:negative"]
            : message.categorySignals;
        const emailMatch = message.from.match(/<([^>]+)>/);
        const fromEmail = emailMatch ? emailMatch[1] : null;
        const encodedMessageId = encodeURIComponent(message.id);
        const encodedRowId = encodeURIComponent(rowId);
        const rewriteAttachmentUrl = (url?: string) => {
          if (!url || rowId === message.id) return url ?? null;
          return url.replaceAll(
            `messageId=${encodedMessageId}`,
            `messageId=${encodedRowId}`
          );
        };
        const rewrittenHtmlBody =
          rowId !== message.id && message.htmlBody
            ? message.htmlBody.replaceAll(
                `messageId=${encodedMessageId}`,
                `messageId=${encodedRowId}`
              )
            : message.htmlBody;
        insertMessage.run(
          rowId,
          message.accountId,
          message.folderId,
          message.threadId,
          message.parentId ?? null,
          message.messageId ?? null,
          message.inReplyTo ?? null,
          message.references ? JSON.stringify(message.references) : null,
          message.xForwardedMessageId ?? null,
          message.xComposeFormat ?? null,
          message.quotedHtmlEdited ? 1 : 0,
          message.subject,
          message.from,
          fromEmail,
          message.to,
          message.cc ?? null,
          message.bcc ?? null,
          message.mailboxPath ?? null,
          typeof message.imapUid === "number" ? message.imapUid : null,
          message.preview,
          message.date,
          message.dateValue,
          message.body,
          rewrittenHtmlBody ?? null,
          message.priority ?? null,
          message.hasSource ? 1 : 0,
          unread ? 1 : 0,
          message.flags ? JSON.stringify(normalizedFlags) : null,
          seen ? 1 : 0,
          answered ? 1 : 0,
          flagged ? 1 : 0,
          deleted ? 1 : 0,
          draft ? 1 : 0,
          recent ? 1 : 0,
          category,
          categoryScore,
          categorySignals ? JSON.stringify(categorySignals) : null,
          manualCategoryState,
          message.listUnsubscribe ?? null,
          message.listId ?? null
        );
        deleteFts.run(rowId);
        insertFts.run(
          rowId,
          message.subject,
          message.from,
          message.to,
          message.cc ?? "",
          message.bcc ?? "",
          message.body,
          message.preview
        );
        normalizeCalendarEventUids(message.calendarEventUids).forEach((eventUid) => {
          const existing = preservedCalendarInviteStateByUid.get(eventUid);
          insertCalendarEvent.run(
            accountId,
            rowId,
            eventUid,
            existing?.eventUidKey ?? normalizeCalendarEventUidKey(eventUid),
            existing?.eventFirstStartAtMs ?? null,
            existing?.eventLastEndAtMs ?? null,
            existing?.inviteActionType ?? null,
            existing?.processedAtMs ?? null,
            existing?.processedByUserId ?? null
          );
        });
        (message.attachments ?? []).forEach((att) => {
          insertAttachment.run(
            att.id,
            rowId,
            att.filename,
            att.contentType,
            att.size,
            att.inline ? 1 : 0,
            att.cid ?? null,
            rewriteAttachmentUrl(att.url) ?? null
          );
        });
      });
      return fileMoves;
    });

    if (replaceExisting) {
      db.transaction(() => {
        deleteAttachmentsByScope.run(...deleteArgs);
        if (folderId) {
          deleteCalendarEventsByScope.run(accountId, accountId, folderId);
        } else {
          deleteCalendarEventsByScope.run(accountId);
        }
        deleteFtsByScope.run(...deleteArgs);
        deleteMessages.run(...deleteArgs);
      })();
    }

    const shouldDeleteAttachments = !replaceExisting;
    for (let start = 0; start < nextMessages.length; start += UPSERT_BATCH_SIZE) {
      const batch = nextMessages.slice(start, start + UPSERT_BATCH_SIZE);
      if (batch.length === 0) continue;
      const fileMoves = upsertBatch(batch, shouldDeleteAttachments);
      if (fileMoves.length > 0) {
        const dedupedMoves = new Map<
          string,
          { previousMessageId: string; nextMessageId: string; attachmentIds: Set<string> }
        >();
        fileMoves.forEach((move: UpsertFileMove) => {
          const key = `${move.previousMessageId}->${move.nextMessageId}`;
          const existing = dedupedMoves.get(key);
          if (existing) {
            move.attachmentIds.forEach((attachmentId) => existing.attachmentIds.add(attachmentId));
            return;
          }
          dedupedMoves.set(key, {
            previousMessageId: move.previousMessageId,
            nextMessageId: move.nextMessageId,
            attachmentIds: new Set(move.attachmentIds)
          });
        });
        for (const move of dedupedMoves.values()) {
          await moveMessageFiles(
            accountId,
            move.previousMessageId,
            move.nextMessageId,
            Array.from(move.attachmentIds)
          );
        }
      }
      if (start + UPSERT_BATCH_SIZE < nextMessages.length) {
        await yieldToEventLoop();
      }
    }

    let affectedThreadIds: string[] = [];
    let requiresFullRecompute = false;

    if (replaceExisting) {
      if (folderId) {
        const affectedThreadIds = new Set<string>([
          ...(existingScopeThreadIds ?? new Set<string>()),
          ...dedupedThreadIds
        ]);
        nextMessages.forEach((message) => {
          if (message.threadId) {
            affectedThreadIds.add(message.threadId);
          }
        });
        const affected = Array.from(affectedThreadIds);
        if (shouldRecomputeThreads && affected.length > 0) {
          await recomputeThreadsForAccountInternal(accountId, affected);
        }
        await rebuildThreadSignalsForThreadIds(db, accountId, affected);
        upsertTopicLearningSignalsForThreadIds(db, accountId, affected);
        pruneThreadTopicsWithoutMessages(db, accountId, affected);
        return { affectedThreadIds: affected, requiresFullRecompute };
      }
      requiresFullRecompute = true;
      if (shouldRecomputeThreads) {
        await recomputeThreadsForAccountInternal(accountId);
      }
      await rebuildAllThreadSignalsForAccount(db, accountId);
      const learningThreadIds = [
        ...(existingAccountThreadIds ?? new Set<string>()),
        ...nextMessages.map((message) => message.threadId).filter(Boolean)
      ];
      upsertTopicLearningSignalsForThreadIds(db, accountId, learningThreadIds);
      pruneThreadTopicsWithoutMessages(db, accountId, [
        ...(existingAccountThreadIds ?? new Set<string>()),
        ...nextMessages.map((message) => message.threadId).filter(Boolean)
      ]);
    } else {
      const affected = Array.from(
        new Set([
          ...nextMessages.map((message) => message.threadId).filter(Boolean),
          ...dedupedThreadIds
        ])
      );
      affectedThreadIds = affected;
      if (shouldRecomputeThreads && affected.length > 0) {
        await recomputeThreadsForAccountInternal(accountId, affected);
      }
      await rebuildThreadSignalsForThreadIds(db, accountId, affected);
      upsertTopicLearningSignalsForThreadIds(db, accountId, affected);
      pruneThreadTopicsWithoutMessages(db, accountId, affected);
    }
    return { affectedThreadIds, requiresFullRecompute };
  });
}

export async function getMessageById(accountId: string, messageId: string) {
  const db = await getAccountDb(accountId);
  const normalizedLookup = messageId.trim();
  const idLookupCandidates = buildMessageRowIdLookupCandidates(normalizedLookup);
  let row: any = null;
  for (const candidateId of idLookupCandidates) {
    row = db
      .prepare(`SELECT * FROM messages WHERE accountId = ? AND id = ?`)
      .get(accountId, candidateId) as any;
    if (row) break;
  }
  if (!row) {
    row = db
      .prepare(
        `SELECT * FROM messages WHERE accountId = ? AND lower(messageId) = lower(?) ORDER BY dateValue DESC LIMIT 1`
      )
      .get(accountId, normalizedLookup) as any;
  }
  if (!row) {
    const trimmed = normalizedLookup.replace(/[<>]/g, "").trim();
    if (trimmed && trimmed !== normalizedLookup) {
      row = db
        .prepare(
          `SELECT * FROM messages WHERE accountId = ? AND lower(messageId) LIKE ? ORDER BY dateValue DESC LIMIT 1`
        )
        .get(accountId, `%${trimmed.toLowerCase()}%`) as any;
    }
  }
  if (!row) return null;
  const attachments = db
    .prepare(`SELECT * FROM attachments WHERE messageId = ?`)
    .all(row.id) as any[];
  const calendarInviteRows = db
    .prepare(
      `SELECT eventUid, inviteActionType, processedAtMs, processedByUserId
       FROM message_calendar_events
       WHERE accountId = ? AND messageId = ?
       ORDER BY eventUid ASC`
    )
    .all(accountId, row.id) as Array<{
    eventUid?: string | null;
    inviteActionType?: string | null;
    processedAtMs?: number | null;
    processedByUserId?: string | null;
  }>;
  const calendarInviteStates = calendarInviteRows
    .map((item) => mapMessageCalendarInviteStateRow(item))
    .filter((item): item is MessageCalendarInviteState => Boolean(item));
  return {
    id: row.id,
    accountId: row.accountId,
    folderId: row.folderId,
    mailboxPath: row.mailboxPath ?? undefined,
    imapUid: typeof row.imapUid === "number" ? row.imapUid : undefined,
    threadId: row.threadId,
    parentId: row.parentId ?? undefined,
    messageId: row.messageId ?? undefined,
    inReplyTo: row.inReplyTo ?? undefined,
    references: parseReferences(row.references),
    xForwardedMessageId: row.xForwardedMessageId ?? undefined,
    subject: row.subject,
    from: row.fromAddr,
    to: row.toAddr,
    cc: row.ccAddr ?? undefined,
    bcc: row.bccAddr ?? undefined,
    preview: row.preview,
    date: row.date,
    dateValue: row.dateValue,
    body: row.body,
    htmlBody: row.htmlBody ?? undefined,
    priority: row.priority ?? undefined,
    hasSource: Boolean(row.hasSource),
    attachments: attachments.map((att) => ({
      id: att.id,
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
      inline: Boolean(att.inline),
      cid: att.cid ?? undefined,
      url: att.url ?? undefined
    })),
    unread: Boolean(row.unread),
    flags: row.flags ? (JSON.parse(row.flags) as string[]) : undefined,
    seen: Boolean(row.seen),
    answered: Boolean(row.answered),
    flagged: Boolean(row.flagged),
    deleted: Boolean(row.deleted),
    draft: Boolean(row.draft),
    recent: Boolean(row.recent),
    category: row.category ?? undefined,
    categoryScore: typeof row.categoryScore === "number" ? row.categoryScore : undefined,
    categorySignals: parseStringArray(row.categorySignals),
    calendarEventUids: normalizeCalendarEventUids(calendarInviteRows.map((item) => item.eventUid)),
    calendarInviteStates,
    listUnsubscribe: row.listUnsubscribe ?? undefined
  } as Message;
}

export async function getStoredMessagesByIds(
  accountId: string,
  messageIds: string[]
): Promise<
  Array<{
    id: string;
    messageId?: string | null;
    folderId: string;
    mailboxPath?: string | null;
    imapUid?: number | null;
  }>
> {
  const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [];
  const db = await getAccountDb(accountId);
  const QUERY_BATCH_SIZE = 400;
  const rows: Array<{
    id: string;
    messageId?: string | null;
    folderId: string;
    mailboxPath?: string | null;
    imapUid?: number | null;
  }> = [];
  for (let start = 0; start < uniqueIds.length; start += QUERY_BATCH_SIZE) {
    const chunk = uniqueIds.slice(start, start + QUERY_BATCH_SIZE);
    rows.push(
      ...((db
        .prepare(
          `SELECT id, messageId, folderId, mailboxPath, imapUid
           FROM messages
           WHERE accountId = ? AND id IN (${chunk.map(() => "?").join(",")})`
        )
        .all(accountId, ...chunk) as Array<{
        id: string;
        messageId?: string | null;
        folderId: string;
        mailboxPath?: string | null;
        imapUid?: number | null;
      }>))
    );
  }
  return rows;
}

export async function getAttachmentMeta(accountId: string, messageId: string, attachmentId: string) {
  const db = await getAccountDb(accountId);
  return db
    .prepare(`SELECT * FROM attachments WHERE messageId = ? AND id = ?`)
    .get(messageId, attachmentId) as any;
}

export async function getAttachmentIds(accountId: string, messageId: string) {
  const db = await getAccountDb(accountId);
  return (db.prepare(`SELECT id FROM attachments WHERE messageId = ?`).all(messageId) as any[]).map(
    (row) => row.id as string
  );
}

export async function listMessageFileRefs(
  accountId: string,
  folderId: string | null = null
) {
  const db = await getAccountDb(accountId);
  const rows = (folderId
    ? db
        .prepare(
          `SELECT m.id as messageId, a.id as attachmentId
           FROM messages m
           LEFT JOIN attachments a ON a.messageId = m.id
           WHERE m.accountId = ? AND m.folderId = ?`
        )
        .all(accountId, folderId)
    : db
        .prepare(
          `SELECT m.id as messageId, a.id as attachmentId
           FROM messages m
           LEFT JOIN attachments a ON a.messageId = m.id
           WHERE m.accountId = ?`
        )
        .all(accountId)) as Array<{ messageId: string; attachmentId: string | null }>;

  const refs = new Map<string, string[]>();
  rows.forEach((row) => {
    if (!refs.has(row.messageId)) {
      refs.set(row.messageId, []);
    }
    if (row.attachmentId) {
      refs.get(row.messageId)!.push(row.attachmentId);
    }
  });

  return Array.from(refs.entries()).map(([messageId, attachmentIds]) => ({
    messageId,
    attachmentIds
  }));
}

export async function listMessageFileRefsByMessageIds(accountId: string, messageIds: string[]) {
  const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [] as Array<{ messageId: string; attachmentIds: string[] }>;
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT m.id as messageId, a.id as attachmentId
       FROM messages m
       LEFT JOIN attachments a ON a.messageId = m.id
       WHERE m.accountId = ? AND m.id IN (${uniqueIds.map(() => "?").join(",")})`
    )
    .all(accountId, ...uniqueIds) as Array<{ messageId: string; attachmentId: string | null }>;

  const refs = new Map<string, string[]>();
  uniqueIds.forEach((id) => {
    refs.set(id, []);
  });
  rows.forEach((row) => {
    if (!refs.has(row.messageId)) {
      refs.set(row.messageId, []);
    }
    if (row.attachmentId) {
      refs.get(row.messageId)!.push(row.attachmentId);
    }
  });

  return Array.from(refs.entries()).map(([messageId, attachmentIds]) => ({
    messageId,
    attachmentIds
  }));
}

export async function listFolderMessageUidRows(accountId: string, folderId: string) {
  const normalizedFolderId = folderId.trim();
  if (!normalizedFolderId) {
    return [] as Array<{ id: string; folderId: string; mailboxPath?: string | null; imapUid: number }>;
  }
  const db = await getAccountDb(accountId);
  return db
    .prepare(
      `SELECT id, folderId, mailboxPath, imapUid
       FROM messages
       WHERE accountId = ? AND folderId = ? AND imapUid IS NOT NULL
       ORDER BY imapUid ASC`
    )
    .all(accountId, normalizedFolderId) as Array<{
    id: string;
    folderId: string;
    mailboxPath?: string | null;
    imapUid: number;
  }>;
}

export async function deleteMessagesWithFilesByIds(accountId: string, messageIds: string[]) {
  const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [] as string[];
  const fileRefs = await listMessageFileRefsByMessageIds(accountId, uniqueIds);
  await Promise.all(
    fileRefs.map((item) => deleteMessageFiles(accountId, item.messageId, item.attachmentIds))
  );
  await deleteMessagesByIds(accountId, uniqueIds);
  return uniqueIds;
}

export async function deleteMessageByFolderUid(
  accountId: string,
  folderId: string,
  imapUid: number
) {
  const normalizedFolderId = folderId.trim();
  if (!normalizedFolderId || !Number.isFinite(imapUid)) {
    return null as { messageId: string; folderId: string; imapUid: number } | null;
  }
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(
      `SELECT id
       FROM messages
       WHERE accountId = ? AND folderId = ? AND imapUid = ?
       LIMIT 1`
    )
    .get(accountId, normalizedFolderId, imapUid) as { id?: string | null } | undefined;
  const messageId = row?.id?.trim();
  if (!messageId) return null;
  await deleteMessagesWithFilesByIds(accountId, [messageId]);
  return {
    messageId,
    folderId: normalizedFolderId,
    imapUid
  };
}

export async function getLatestMessageDate(accountId: string, mailboxPath?: string) {
  const db = await getAccountDb(accountId);
  if (mailboxPath) {
    const row = db
      .prepare(`SELECT MAX(dateValue) as maxDate FROM messages WHERE accountId = ? AND mailboxPath = ?`)
      .get(accountId, mailboxPath) as { maxDate?: number | null } | undefined;
    return typeof row?.maxDate === "number" ? row.maxDate : null;
  }
  const row = db
    .prepare(`SELECT MAX(dateValue) as maxDate FROM messages WHERE accountId = ?`)
    .get(accountId) as { maxDate?: number | null } | undefined;
  return typeof row?.maxDate === "number" ? row.maxDate : null;
}

export async function getLatestMessageUid(accountId: string, mailboxPath?: string) {
  const db = await getAccountDb(accountId);
  if (mailboxPath) {
    const row = db
      .prepare(
        `SELECT MAX(imapUid) as maxUid FROM messages WHERE accountId = ? AND mailboxPath = ?`
      )
      .get(accountId, mailboxPath) as { maxUid?: number | null } | undefined;
    return typeof row?.maxUid === "number" ? row.maxUid : null;
  }
  const row = db
    .prepare(`SELECT MAX(imapUid) as maxUid FROM messages WHERE accountId = ?`)
    .get(accountId) as { maxUid?: number | null } | undefined;
  return typeof row?.maxUid === "number" ? row.maxUid : null;
}

export async function updateMessageFolder(
  accountId: string,
  messageId: string,
  folderId: string,
  mailboxPath: string,
  imapUid?: number | null
) {
  return withDbWriteRetry("updateMessageFolder", async () => {
    const db = await getAccountDb(accountId);
    if (imapUid === null) {
      db.prepare(
        `UPDATE messages
         SET folderId = ?, mailboxPath = ?, imapUid = NULL
         WHERE accountId = ? AND id = ?`
      ).run(folderId, mailboxPath, accountId, messageId);
      return;
    }
    if (typeof imapUid === "number" && Number.isFinite(imapUid)) {
      db.prepare(
        `UPDATE messages
         SET folderId = ?, mailboxPath = ?, imapUid = ?
         WHERE accountId = ? AND id = ?`
      ).run(folderId, mailboxPath, imapUid, accountId, messageId);
      return;
    }
    db.prepare(
      `UPDATE messages SET folderId = ?, mailboxPath = ? WHERE accountId = ? AND id = ?`
    ).run(folderId, mailboxPath, accountId, messageId);
  });
}

export type StagedMessageMove = {
  messageId: string;
  sourceFolderId: string;
  sourceMailboxPath: string;
  sourceUid: number;
  destinationFolderId: string;
  destinationMailboxPath: string;
};

export async function stageMessageMoves(params: {
  accountId: string;
  messageIds: string[];
  destinationFolderId: string;
  destinationMailboxPath: string;
}) {
  const { accountId, messageIds, destinationFolderId, destinationMailboxPath } = params;
  const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [] as StagedMessageMove[];
  return withDbWriteRetry("stageMessageMoves", async () => {
    const db = await getAccountDb(accountId);
    const rows = db
      .prepare(
        `SELECT id, folderId, mailboxPath, imapUid
         FROM messages
         WHERE accountId = ? AND id IN (${uniqueIds.map(() => "?").join(",")})`
      )
      .all(accountId, ...uniqueIds) as Array<{
      id: string;
      folderId: string;
      mailboxPath?: string | null;
      imapUid?: number | null;
    }>;
    const updateMessage = db.prepare(
      `UPDATE messages
       SET folderId = ?, mailboxPath = ?, imapUid = NULL
       WHERE accountId = ? AND id = ?`
    );
    const staged: StagedMessageMove[] = [];
    db.transaction(() => {
      rows.forEach((row) => {
        if (
          typeof row.imapUid !== "number" ||
          !Number.isFinite(row.imapUid) ||
          !row.mailboxPath ||
          !row.folderId
        ) {
          return;
        }
        if (
          row.folderId === destinationFolderId &&
          row.mailboxPath === destinationMailboxPath
        ) {
          return;
        }
        updateMessage.run(destinationFolderId, destinationMailboxPath, accountId, row.id);
        staged.push({
          messageId: row.id,
          sourceFolderId: row.folderId,
          sourceMailboxPath: row.mailboxPath,
          sourceUid: row.imapUid,
          destinationFolderId,
          destinationMailboxPath
        });
      });
    })();
    return staged;
  });
}

export type RelocateMovedMessageResult = {
  previousId: string;
  nextId: string;
  attachmentIds: string[];
  changed: boolean;
};

export async function relocateMovedMessage(params: {
  accountId: string;
  previousId: string;
  destinationFolderId: string;
  destinationMailboxPath: string;
  destinationUid?: number | null;
}) {
  const {
    accountId,
    previousId,
    destinationFolderId,
    destinationMailboxPath,
    destinationUid
  } = params;
  return withDbWriteRetry("relocateMovedMessage", async () => {
    const db = await getAccountDb(accountId);
    const normalizedPreviousId = previousId.trim();
    const existing = db
      .prepare(`SELECT id FROM messages WHERE accountId = ? AND id = ?`)
      .get(accountId, normalizedPreviousId) as { id: string } | undefined;
    if (!existing) return null;

    const attachmentIds = (db
      .prepare(`SELECT id FROM attachments WHERE messageId = ?`)
      .all(normalizedPreviousId) as Array<{ id?: string | null }>)
      .map((row) => (row.id ? String(row.id) : ""))
      .filter(Boolean);
    if (destinationUid === null) {
      db.prepare(
        `UPDATE messages
         SET folderId = ?, mailboxPath = ?, imapUid = NULL
         WHERE accountId = ? AND id = ?`
      ).run(destinationFolderId, destinationMailboxPath, accountId, normalizedPreviousId);
    } else if (typeof destinationUid === "number" && Number.isFinite(destinationUid)) {
      db.prepare(
        `UPDATE messages
         SET folderId = ?, mailboxPath = ?, imapUid = ?
         WHERE accountId = ? AND id = ?`
      ).run(
        destinationFolderId,
        destinationMailboxPath,
        destinationUid,
        accountId,
        normalizedPreviousId
      );
    } else {
      db.prepare(
        `UPDATE messages
         SET folderId = ?, mailboxPath = ?
         WHERE accountId = ? AND id = ?`
      ).run(destinationFolderId, destinationMailboxPath, accountId, normalizedPreviousId);
    }

    return {
      previousId: normalizedPreviousId,
      nextId: normalizedPreviousId,
      attachmentIds,
      changed: false
    } satisfies RelocateMovedMessageResult;
  });
}

export async function deleteMessageById(accountId: string, messageId: string) {
  return withDbWriteRetry("deleteMessageById", async () => {
    const db = await getAccountDb(accountId);
    const row = db
      .prepare(`SELECT threadId FROM messages WHERE accountId = ? AND id = ?`)
      .get(accountId, messageId) as { threadId?: string | null } | undefined;
    db.prepare(`DELETE FROM attachments WHERE messageId = ?`).run(messageId);
    db.prepare(`DELETE FROM message_fts WHERE messageId = ?`).run(messageId);
    db.prepare(`DELETE FROM messages WHERE accountId = ? AND id = ?`).run(accountId, messageId);
    if (row?.threadId) {
      await recomputeThreadsForAccountInternal(accountId, [row.threadId]);
      await rebuildThreadSignalsForThreadIds(db, accountId, [row.threadId]);
      upsertTopicLearningSignalsForThreadIds(db, accountId, [row.threadId]);
      pruneThreadTopicsWithoutMessages(db, accountId, [row.threadId]);
    }
  });
}

export async function deleteMessagesByIds(accountId: string, messageIds: string[]) {
  const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return;
  return withDbWriteRetry("deleteMessagesByIds", async () => {
    const db = await getAccountDb(accountId);
    const placeholders = uniqueIds.map(() => "?").join(",");
    const threadRows = db
      .prepare(
        `SELECT DISTINCT threadId
         FROM messages
         WHERE accountId = ? AND id IN (${placeholders}) AND threadId IS NOT NULL`
      )
      .all(accountId, ...uniqueIds) as Array<{ threadId: string }>;
    const threadIds = threadRows.map((row) => row.threadId).filter(Boolean);
    db.prepare(
      `DELETE FROM attachments
       WHERE messageId IN (
         SELECT id FROM messages
         WHERE accountId = ? AND id IN (${placeholders})
       )`
    ).run(accountId, ...uniqueIds);
    db.prepare(
      `DELETE FROM message_fts
       WHERE messageId IN (
         SELECT id FROM messages
         WHERE accountId = ? AND id IN (${placeholders})
       )`
    ).run(accountId, ...uniqueIds);
    db.prepare(`DELETE FROM messages WHERE accountId = ? AND id IN (${placeholders})`).run(
      accountId,
      ...uniqueIds
    );
    if (threadIds.length > 0) {
      await recomputeThreadsForAccountInternal(accountId, threadIds);
      await rebuildThreadSignalsForThreadIds(db, accountId, threadIds);
      upsertTopicLearningSignalsForThreadIds(db, accountId, threadIds);
      pruneThreadTopicsWithoutMessages(db, accountId, threadIds);
    }
  });
}

export async function updateMessageFlags(
  accountId: string,
  messageId: string,
  flags: string[]
) {
  return withDbWriteRetry("updateMessageFlags", async () => {
    const db = await getAccountDb(accountId);
    const normalizedFlags = normalizeImapFlags(flags);
    const system = deriveSystemFlagState(normalizedFlags);
    db.prepare(
      `UPDATE messages
       SET flags = ?,
           seen = ?,
           answered = ?,
           flagged = ?,
           deleted = ?,
           draft = ?,
           recent = ?,
           unread = ?
       WHERE accountId = ? AND id = ?`
    ).run(
      JSON.stringify(normalizedFlags),
      system.seen,
      system.answered,
      system.flagged,
      system.deleted,
      system.draft,
      system.recent,
      system.unread,
      accountId,
      messageId
    );
    const row = db
      .prepare(`SELECT threadId FROM messages WHERE accountId = ? AND id = ?`)
      .get(accountId, messageId) as { threadId?: string | null } | undefined;
    if (row?.threadId) {
      await recomputeThreadsForAccountInternal(accountId, [row.threadId]);
    }
  });
}

function normalizeCategoryLinearModel(
  model: Partial<CategoryLinearModel> | null | undefined,
  options?: { touchUpdatedAt?: boolean }
): CategoryLinearModel {
  const seeded = createSeededLinearModel();
  const normalizedModel: CategoryLinearModel = {
    ...seeded,
    ...(model ?? {}),
    bias: {
      ...seeded.bias,
      ...(model?.bias ?? {})
    },
    weights: {
      newsletter: {
        ...seeded.weights.newsletter,
        ...(model?.weights?.newsletter ?? {})
      },
      notification: {
        ...seeded.weights.notification,
        ...(model?.weights?.notification ?? {})
      },
      transactional: {
        ...seeded.weights.transactional,
        ...(model?.weights?.transactional ?? {})
      }
    }
  };
  if (options?.touchUpdatedAt) {
    normalizedModel.updatedAt = Date.now();
  }
  return normalizedModel;
}

function loadCategoryLinearModelFromRow(row: { modelJson?: string | null } | undefined) {
  if (!row?.modelJson) return createSeededLinearModel();
  try {
    const parsed = JSON.parse(row.modelJson) as Partial<CategoryLinearModel> | null;
    if (!parsed || typeof parsed !== "object") return createSeededLinearModel();
    return normalizeCategoryLinearModel(parsed);
  } catch {
    return createSeededLinearModel();
  }
}

function saveCategoryLinearModelToDb(db: any, accountId: string, model: CategoryLinearModel) {
  const normalizedModel = normalizeCategoryLinearModel(model, { touchUpdatedAt: true });
  db.prepare(
    `INSERT OR REPLACE INTO category_model_state (accountId, modelJson, updatedAt) VALUES (?, ?, ?)`
  ).run(accountId, JSON.stringify(normalizedModel), normalizedModel.updatedAt);
  return normalizedModel;
}

export async function getCategoryLinearModel(accountId: string): Promise<CategoryLinearModel> {
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(`SELECT modelJson FROM category_model_state WHERE accountId = ?`)
    .get(accountId) as { modelJson?: string | null } | undefined;
  if (!row?.modelJson) {
    return saveCategoryLinearModelToDb(db, accountId, createSeededLinearModel());
  }
  return loadCategoryLinearModelFromRow(row);
}

export async function resetCategoryLinearModel(accountId: string): Promise<CategoryLinearModel> {
  return withDbWriteRetry("resetCategoryLinearModel", async () => {
    const db = await getAccountDb(accountId);
    let model = createSeededLinearModel();
    db.transaction(() => {
      db.prepare(`DELETE FROM category_feedback_events WHERE accountId = ?`).run(accountId);
      model = saveCategoryLinearModelToDb(db, accountId, createSeededLinearModel());
    })();
    return model;
  });
}

function summarizeTopWeights(weights: Record<string, number>, limit: number) {
  return Object.entries(weights ?? {})
    .filter(([, value]) => Number.isFinite(value) && Math.abs(value) >= 0.0001)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, limit)
    .map(([feature, weight]) => ({
      feature,
      weight: Number(weight.toFixed(4))
    }));
}

function parseFeatureCount(featureJson?: string | null) {
  if (!featureJson) return 0;
  try {
    const parsed = JSON.parse(featureJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
    return Object.keys(parsed as Record<string, unknown>).length;
  } catch {
    return 0;
  }
}

export async function getCategoryLearningDebugSnapshot(
  accountId: string,
  options?: { eventLimit?: number; topFeatureLimit?: number }
): Promise<CategoryLearningDebugSnapshot> {
  const db = await getAccountDb(accountId);
  const eventLimit = Math.max(5, Math.min(100, options?.eventLimit ?? 20));
  const topFeatureLimit = Math.max(3, Math.min(25, options?.topFeatureLimit ?? 8));

  const modelRow = db
    .prepare(`SELECT modelJson, updatedAt FROM category_model_state WHERE accountId = ?`)
    .get(accountId) as { modelJson?: string | null; updatedAt?: number | null } | undefined;

  const parsedModel = modelRow?.modelJson ? loadCategoryLinearModelFromRow(modelRow) : null;
  const model = parsedModel
    ? {
        version: parsedModel.version,
        updatedAt:
          typeof parsedModel.updatedAt === "number"
            ? parsedModel.updatedAt
            : Number(modelRow?.updatedAt ?? Date.now()),
        examples: Number(parsedModel.examples ?? 0),
        learningRate: Number(parsedModel.learningRate ?? 0.1),
        l2: Number(parsedModel.l2 ?? 0),
        bias: {
          newsletter: Number((parsedModel.bias.newsletter ?? 0).toFixed(4)),
          notification: Number((parsedModel.bias.notification ?? 0).toFixed(4)),
          transactional: Number((parsedModel.bias.transactional ?? 0).toFixed(4))
        },
        featureCounts: {
          newsletter: Object.keys(parsedModel.weights.newsletter ?? {}).length,
          notification: Object.keys(parsedModel.weights.notification ?? {}).length,
          transactional: Object.keys(parsedModel.weights.transactional ?? {}).length
        },
        topWeights: {
          newsletter: summarizeTopWeights(parsedModel.weights.newsletter ?? {}, topFeatureLimit),
          notification: summarizeTopWeights(parsedModel.weights.notification ?? {}, topFeatureLimit),
          transactional: summarizeTopWeights(parsedModel.weights.transactional ?? {}, topFeatureLimit)
        }
      }
    : null;

  const feedbackCountRow = db
    .prepare(
      `SELECT COUNT(*) as count, MAX(createdAt) as lastEventAt
       FROM category_feedback_events
       WHERE accountId = ?`
    )
    .get(accountId) as { count?: number; lastEventAt?: number | null } | undefined;

  const transitionRows = db
    .prepare(
      `SELECT previousCategory, nextCategory, COUNT(*) as count
       FROM category_feedback_events
       WHERE accountId = ?
       GROUP BY previousCategory, nextCategory
       ORDER BY count DESC, COALESCE(nextCategory, ''), COALESCE(previousCategory, '')
       LIMIT 20`
    )
    .all(accountId) as Array<{
    previousCategory?: string | null;
    nextCategory?: string | null;
    count?: number | null;
  }>;

  const recentRows = db
    .prepare(
      `SELECT messageId, previousCategory, nextCategory, featureJson, createdAt
       FROM category_feedback_events
       WHERE accountId = ?
       ORDER BY createdAt DESC
       LIMIT ?`
    )
    .all(accountId, eventLimit) as Array<{
    messageId?: string | null;
    previousCategory?: string | null;
    nextCategory?: string | null;
    featureJson?: string | null;
    createdAt?: number | null;
  }>;

  const categoryCountRows = db
    .prepare(
      `SELECT category, COUNT(*) as count
       FROM messages
       WHERE accountId = ?
       GROUP BY category`
    )
    .all(accountId) as Array<{ category?: string | null; count?: number | null }>;
  const categoryCountMap = new Map<
    "newsletter" | "notification" | "transactional" | "uncategorized",
    number
  >();
  categoryCountRows.forEach((row) => {
    const normalized = normalizeCategory(row.category);
    const key = normalized ?? "uncategorized";
    categoryCountMap.set(key, (categoryCountMap.get(key) ?? 0) + Number(row.count ?? 0));
  });
  const orderedCategoryKeys: Array<
    "newsletter" | "notification" | "transactional" | "uncategorized"
  > = ["newsletter", "notification", "transactional", "uncategorized"];
  const categoryCounts = orderedCategoryKeys
    .map((key) => ({ category: key, count: categoryCountMap.get(key) ?? 0 }))
    .filter((entry) => entry.count > 0 || entry.category === "uncategorized");

  const manualCategorizedCountRow = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM messages
       WHERE accountId = ? AND COALESCE(categorySignals, '') LIKE '%manual-feedback:%'`
    )
    .get(accountId) as { count?: number | null } | undefined;

  return {
    model,
    feedback: {
      totalEvents: Number(feedbackCountRow?.count ?? 0),
      lastEventAt:
        typeof feedbackCountRow?.lastEventAt === "number" ? feedbackCountRow.lastEventAt : null,
      transitions: transitionRows.map((row) => ({
        previousCategory: normalizeCategory(row.previousCategory),
        nextCategory: normalizeCategory(row.nextCategory),
        count: Number(row.count ?? 0)
      })),
      recent: recentRows.map((row) => ({
        messageId: row.messageId ?? "",
        previousCategory: normalizeCategory(row.previousCategory),
        nextCategory: normalizeCategory(row.nextCategory),
        createdAt: Number(row.createdAt ?? 0),
        featureCount: parseFeatureCount(row.featureJson)
      }))
    },
    categoryCounts,
    manualCategorizedCount: Number(manualCategorizedCountRow?.count ?? 0)
  };
}

export async function setMessageCategory(
  accountId: string,
  messageId: string,
  category: CategoryKey | null,
  categoryScore: number | null,
  categorySignals: string[]
) {
  return withDbWriteRetry("setMessageCategory", async () => {
    const db = await getAccountDb(accountId);
    db.prepare(
      `UPDATE messages
       SET category = ?, categoryScore = ?, categorySignals = ?, categoryManualState = NULL
       WHERE accountId = ? AND id = ?`
    ).run(
      category,
      typeof categoryScore === "number" ? categoryScore : null,
      JSON.stringify(categorySignals ?? []),
      accountId,
      messageId
    );
  });
}

function buildFallbackParsedMessageForFeedback(
  row: {
    fromAddr?: string | null;
    fromEmail?: string | null;
    subject?: string | null;
    body?: string | null;
    preview?: string | null;
  },
  attachmentFilenames: string[]
) {
  const fromAddress =
    row.fromEmail ||
    row.fromAddr?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ||
    "";
  return {
    from: { value: [{ address: fromAddress }] },
    subject: row.subject ?? "",
    text: `${row.preview ?? ""}\n${row.body ?? ""}`.trim(),
    attachments: attachmentFilenames.map((filename) => ({ filename }))
  } as any;
}

export async function applyCategoryFeedback(
  accountId: string,
  messageId: string,
  nextCategoryInput: string | null
) {
  const nextCategory = normalizeCategory(nextCategoryInput);
  return withDbWriteRetry("applyCategoryFeedback", async () => {
    const db = await getAccountDb(accountId);
    const row = db
      .prepare(
        `SELECT id, category, categorySignals, fromAddr, fromEmail, subject, body, preview
         FROM messages
         WHERE accountId = ? AND id = ?`
      )
      .get(accountId, messageId) as
      | {
          id: string;
          category?: string | null;
          categorySignals?: string | null;
          fromAddr?: string | null;
          fromEmail?: string | null;
          subject?: string | null;
          body?: string | null;
          preview?: string | null;
        }
      | undefined;

    if (!row?.id) {
      throw new Error("Message not found");
    }

    const previousCategory = normalizeCategory(row.category);
    const attachmentRows = db
      .prepare(`SELECT filename FROM attachments WHERE messageId = ?`)
      .all(messageId) as Array<{ filename?: string | null }>;
    const attachmentFilenames = attachmentRows
      .map((item) => (item.filename ?? "").trim())
      .filter(Boolean);

    let features: Record<string, number> | null = null;
    try {
      const { getMessageSource } = await import("./storage");
      const source = await getMessageSource(accountId, messageId);
      if (source) {
        const parsed = await simpleParser(source);
        const headers = (parsed.headers ?? new Map()) as Map<string, any>;
        features = extractLinearFeatures(parsed as any, headers, parseStringArray(row.categorySignals));
      }
    } catch {
      features = null;
    }

    if (!features) {
      const fallbackParsed = buildFallbackParsedMessageForFeedback(row, attachmentFilenames);
      features = extractLinearFeatures(fallbackParsed as any, new Map(), parseStringArray(row.categorySignals));
    }

    const modelRow = db
      .prepare(`SELECT modelJson FROM category_model_state WHERE accountId = ?`)
      .get(accountId) as { modelJson?: string | null } | undefined;
    let model = loadCategoryLinearModelFromRow(modelRow);
    if (nextCategory) {
      model = trainLinearModelPositive(model, features, nextCategory);
    } else if (previousCategory) {
      model = trainLinearModelNegative(model, features, previousCategory);
    }
    model = saveCategoryLinearModelToDb(db, accountId, model);

    const manualSignals = nextCategory
      ? [`manual-category:${nextCategory}`, "manual-feedback:positive"]
      : ["manual-category:cleared", "manual-feedback:negative"];
    const manualCategoryState: CategoryManualState | null = nextCategory ? null : "cleared";
    db.prepare(
      `UPDATE messages
       SET category = ?, categoryScore = ?, categorySignals = ?, categoryManualState = ?
       WHERE accountId = ? AND id = ?`
    ).run(
      nextCategory,
      nextCategory ? 1 : null,
      JSON.stringify(manualSignals),
      manualCategoryState,
      accountId,
      messageId
    );

    db.prepare(
      `INSERT OR REPLACE INTO category_feedback_events
       (id, accountId, messageId, previousCategory, nextCategory, featureJson, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomUUID(),
      accountId,
      messageId,
      previousCategory,
      nextCategory,
      JSON.stringify(features),
      Date.now()
    );

    const updatedMessage = await getMessageById(accountId, messageId);
    return {
      message: updatedMessage,
      previousCategory,
      nextCategory,
      modelExamples: model.examples
    };
  });
}

export async function deleteMessagesByFolderPrefix(accountId: string, folderPrefix: string) {
  return withDbWriteRetry("deleteMessagesByFolderPrefix", async () => {
    const db = await getAccountDb(accountId);
    const prefix = `${accountId}:${folderPrefix}`;
    const threadRows = db
      .prepare(
        `SELECT DISTINCT threadId
         FROM messages
         WHERE accountId = ? AND folderId LIKE ? AND threadId IS NOT NULL`
      )
      .all(accountId, `${prefix}%`) as Array<{ threadId: string }>;
    if (threadRows.length === 0) {
      return;
    }
    const threadIds = threadRows.map((row) => row.threadId).filter(Boolean);
    db.prepare(
      `DELETE FROM attachments WHERE messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId LIKE ?)`
    ).run(accountId, `${prefix}%`);
    db.prepare(
      `DELETE FROM message_fts WHERE messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId LIKE ?)`
    ).run(accountId, `${prefix}%`);
    db.prepare(`DELETE FROM messages WHERE accountId = ? AND folderId LIKE ?`).run(
      accountId,
      `${prefix}%`
    );
    if (threadIds.length > 0) {
      await recomputeThreadsForAccountInternal(accountId, threadIds);
      await rebuildThreadSignalsForThreadIds(db, accountId, threadIds);
      upsertTopicLearningSignalsForThreadIds(db, accountId, threadIds);
      pruneThreadTopicsWithoutMessages(db, accountId, threadIds);
    }
  });
}

export async function listRecipientSuggestions(
  accountId: string,
  limit = 200,
  query?: string | null
) {
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT toAddr, ccAddr, bccAddr
       FROM messages
       WHERE accountId = ?
       ORDER BY dateValue DESC
       LIMIT 2000`
    )
    .all(accountId) as Array<{
      toAddr?: string | null;
      ccAddr?: string | null;
      bccAddr?: string | null;
    }>;
  const counts = new Map<string, number>();
  const names = new Map<string, string>();
  const normalizeName = (name: string) =>
    name.replace(/^"|"$/g, "").replace(/\s+/g, " ").trim();
  const addAddress = (emailRaw: string, nameRaw?: string) => {
    const email = emailRaw.trim().toLowerCase();
    if (!email) return;
    counts.set(email, (counts.get(email) ?? 0) + 1);
    if (nameRaw) {
      const cleaned = normalizeName(nameRaw);
      if (cleaned && !names.get(email)) {
        names.set(email, cleaned);
      }
    }
  };
  const addEmails = (value?: string | null) => {
    if (!value) return;
    const seen = new Set<string>();
    const pattern = /(?:"?([^"<]*)"?\s*)?<([^>]+)>/g;
    let match = pattern.exec(value);
    while (match) {
      const name = match[1];
      const email = match[2];
      if (email) {
        const key = email.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          addAddress(email, name);
        }
      }
      match = pattern.exec(value);
    }
    const standalone = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    standalone.forEach((entry) => {
      const key = entry.trim().toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      addAddress(entry);
    });
  };
  rows.forEach((row) => {
    addEmails(row.toAddr);
    addEmails(row.ccAddr);
    addEmails(row.bccAddr);
  });
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([email]) => {
      const name = names.get(email);
      return name ? `${name} <${email}>` : email;
    })
    .filter((value) => {
      if (!normalizedQuery) return true;
      return value.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, limit);
}

export async function updateMessagesFolderPrefix(
  accountId: string,
  oldPrefix: string,
  newPrefix: string
) {
  return withDbWriteRetry("updateMessagesFolderPrefix", async () => {
    const db = await getAccountDb(accountId);
    const oldFull = `${accountId}:${oldPrefix}`;
    const newFull = `${accountId}:${newPrefix}`;
    db.prepare(
      `UPDATE messages
       SET folderId = REPLACE(folderId, ?, ?),
           mailboxPath = REPLACE(mailboxPath, ?, ?)
       WHERE accountId = ? AND folderId LIKE ?`
    ).run(oldFull, newFull, oldPrefix, newPrefix, accountId, `${oldFull}%`);
  });
}

export async function recomputeCategoriesForAccount(
  accountId: string,
  options?: { folderId?: string | null }
) {
  console.log(`[RECOMPUTE CATEGORIES] Starting for account ${accountId}`);

  const {
    classifyCategoryFromMetadata,
    getCategorizationConfig,
    parseMailForCategorization
  } = await import("@/lib/mail/categorization");
  const { getMessageSource } = await import("@/lib/storage");

  const db = await getAccountDb(accountId);
  const account = await getAccountById(accountId);
  const accountEmail = account?.email ?? "";
  const folderIdFilter = options?.folderId?.trim() ? options.folderId.trim() : null;

  // Get all eligible message IDs (source-backed and metadata-only).
  const messages = db
    .prepare(
      `SELECT m.id, m.mailboxPath, m.fromEmail, m.fromAddr, m.subject, m.inReplyTo, m."references" AS "references", m.hasSource, f.specialUse AS folderSpecialUse
       FROM messages m
       LEFT JOIN folders f
         ON f.accountId = m.accountId
        AND f.id = m.folderId
       WHERE m.accountId = ?
         AND (? IS NULL OR m.folderId = ?)
         AND COALESCE(m.categoryManualState, '') <> 'cleared'`
    )
    .all(accountId, folderIdFilter, folderIdFilter) as Array<{
      id: string;
      mailboxPath?: string | null;
      fromEmail?: string | null;
      fromAddr?: string | null;
      subject?: string | null;
      inReplyTo?: string | null;
      references?: string | null;
      hasSource?: number | null;
      folderSpecialUse?: string | null;
    }>;

  console.log(`[RECOMPUTE CATEGORIES] Found ${messages.length} eligible messages`);

  if (messages.length === 0) {
    console.log(`No eligible messages found for account ${accountId}`);
    return;
  }

  console.log(`Recomputing categories for ${messages.length} messages...`);

  const config = getCategorizationConfig();
  const linearModel = await getCategoryLinearModel(accountId);
  const updateStmt = db.prepare(
    `UPDATE messages SET category = ?, categoryScore = ?, categorySignals = ? WHERE accountId = ? AND id = ?`
  );

  let processed = 0;
  let categorized = 0;

  for (const message of messages) {
    const id = message.id;
    try {
      const metadataHeaderMap = new Map<string, unknown>();
      const inReplyTo = message.inReplyTo?.trim();
      if (inReplyTo) {
        metadataHeaderMap.set("in-reply-to", inReplyTo);
      }
      const refs = parseReferences(message.references);
      if (refs && refs.length > 0) {
        metadataHeaderMap.set("references", refs.join(" "));
      }

      let classificationInput:
        | {
            subject?: string | null;
            from?: unknown;
            attachments?: Array<{ filename?: string | null }> | undefined;
            headers?: Map<string, unknown>;
          }
        | null = null;

      if (message.hasSource) {
        const source = await getMessageSource(accountId, id);
        if (source) {
          const parsed = await parseMailForCategorization(source);
          classificationInput = {
            subject: parsed.subject,
            from: parsed.from,
            attachments: parsed.attachments as Array<{ filename?: string | null }> | undefined,
            headers: parsed.headers as Map<string, unknown>
          };
        }
      }

      if (!classificationInput) {
        const attachmentRows = db
          .prepare(`SELECT filename FROM attachments WHERE messageId = ?`)
          .all(id) as Array<{ filename?: string | null }>;
        const attachmentFilenames = attachmentRows
          .map((item) => (item.filename ?? "").trim())
          .filter(Boolean);
        const fallbackParsed = buildFallbackParsedMessageForFeedback(
          {
            fromAddr: message.fromAddr,
            fromEmail: message.fromEmail,
            subject: message.subject
          },
          attachmentFilenames
        );
        classificationInput = {
          subject: fallbackParsed.subject,
          from: fallbackParsed.from,
          attachments: fallbackParsed.attachments as Array<{ filename?: string | null }> | undefined,
          headers: metadataHeaderMap
        };
      }

      const classification = classifyCategoryFromMetadata(classificationInput, {
        config,
        linearModel,
        context: {
          accountEmail,
          mailboxPath: message.mailboxPath ?? null,
          folderSpecialUse: message.folderSpecialUse ?? null,
          fromAddressHint: message.fromEmail ?? message.fromAddr ?? null
        }
      });

      await withDbWriteRetry("recomputeCategoriesForAccount.updateCategory", () =>
        updateStmt.run(
          classification.category || null,
          classification.confidence || null,
          JSON.stringify(classification.signals ?? []),
          accountId,
          id
        )
      );

      if (classification.category) {
        categorized++;
      }

      processed++;
      if (processed % 100 === 0) {
        console.log(`Processed ${processed}/${messages.length} messages, ${categorized} categorized`);
      }
    } catch (error) {
      console.error(`Failed to recompute category for message ${id}:`, error);
    }
  }

  console.log(`Finished: ${processed}/${messages.length} processed, ${categorized} categorized`);
}

// ── Calendar Events ──────────────────────────────────────────────────────────

function rowToCalendarEvent(row: any): CalendarEvent {
  return {
    id: row.id,
    accountId: row.accountId,
    calendarId: row.calendarId ?? undefined,
    eventUid: row.eventUid,
    summary: row.summary,
    description: row.description ?? undefined,
    location: row.location ?? undefined,
    startAtMs: row.startAtMs,
    endAtMs: row.endAtMs ?? undefined,
    allDay: Boolean(row.allDay),
    startTimezone: row.startTimezone ?? undefined,
    endTimezone: row.endTimezone ?? undefined,
    recurrenceRule: row.recurrenceRule ?? undefined,
    recurrenceDates: row.recurrenceDates ? JSON.parse(row.recurrenceDates) : undefined,
    excludedDates: row.excludedDates ? JSON.parse(row.excludedDates) : undefined,
    status: row.status ?? undefined,
    organizer: row.organizer ?? undefined,
    attendees: row.attendees ?? undefined,
    myPartstat: row.myPartstat ?? undefined,
    myPartstatUpdatedAtMs: row.myPartstatUpdatedAtMs ?? undefined,
    myAttendeeEmail: row.myAttendeeEmail ?? undefined,
    replyRequested: row.replyRequested == null ? undefined : Boolean(row.replyRequested),
    remoteEtag: row.remoteEtag ?? undefined,
    remoteHref: row.remoteHref ?? undefined,
    rawIcs: row.rawIcs ?? undefined,
    sourceType: (row.sourceType as CalendarEventSourceType) ?? "local",
    messageId: row.messageId ?? undefined,
    occurrenceMessageIds: row.occurrenceMessageIds ? JSON.parse(row.occurrenceMessageIds) : undefined,
    createdAtMs: row.createdAtMs,
    updatedAtMs: row.updatedAtMs,
    deletedAtMs: row.deletedAtMs ?? undefined
  };
}

type CalendarParticipationOverrideRow = {
  id: string;
  accountId: string;
  eventUid: string;
  occurrenceStartAtMs: number;
  partstat: CalendarParticipationStatus;
  attendeeEmail?: string;
  updatedAtMs: number;
};

export type CalendarParticipationResolution = {
  partstat?: CalendarParticipationStatus;
  scope: CalendarParticipationScope;
  canRespond: boolean;
  isRecurring: boolean;
  occurrenceStartAtMs?: number;
};

function rowToCalendarParticipationOverride(row: any): CalendarParticipationOverrideRow | null {
  const partstat = normalizeCalendarParticipationStatus(row.partstat);
  const occurrenceStartAtMs = Number(row.occurrenceStartAtMs);
  const updatedAtMs = Number(row.updatedAtMs);
  if (!partstat || !Number.isFinite(occurrenceStartAtMs) || !Number.isFinite(updatedAtMs)) {
    return null;
  }
  return {
    id: String(row.id),
    accountId: String(row.accountId),
    eventUid: String(row.eventUid),
    occurrenceStartAtMs,
    partstat,
    attendeeEmail: row.attendeeEmail ? String(row.attendeeEmail) : undefined,
    updatedAtMs
  };
}

async function getCalendarParticipationOverrideForOccurrence(
  accountId: string,
  eventUid: string,
  occurrenceStartAtMs: number
): Promise<CalendarParticipationOverrideRow | null> {
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(
      `SELECT * FROM calendar_participation_overrides
       WHERE accountId = ? AND eventUid = ? AND occurrenceStartAtMs = ?`
    )
    .get(accountId, eventUid, occurrenceStartAtMs) as any;
  return row ? rowToCalendarParticipationOverride(row) : null;
}

export async function upsertCalendarParticipationOverride(
  accountId: string,
  input: {
    eventUid: string;
    occurrenceStartAtMs: number;
    partstat: CalendarParticipationStatus;
    attendeeEmail?: string;
  }
): Promise<CalendarParticipationOverrideRow> {
  const db = await getAccountDb(accountId);
  const now = Date.now();
  const existing = await getCalendarParticipationOverrideForOccurrence(
    accountId,
    input.eventUid,
    input.occurrenceStartAtMs
  );
  const row: CalendarParticipationOverrideRow = {
    id: existing?.id ?? `calp-${crypto.randomUUID()}`,
    accountId,
    eventUid: input.eventUid,
    occurrenceStartAtMs: input.occurrenceStartAtMs,
    partstat: input.partstat,
    attendeeEmail: input.attendeeEmail,
    updatedAtMs: now
  };
  db.prepare(
    `INSERT OR REPLACE INTO calendar_participation_overrides (
      id, accountId, eventUid, occurrenceStartAtMs, partstat, attendeeEmail, updatedAtMs
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.accountId,
    row.eventUid,
    row.occurrenceStartAtMs,
    row.partstat,
    row.attendeeEmail ?? null,
    row.updatedAtMs
  );
  return row;
}

export async function deleteCalendarParticipationOverrideForOccurrence(
  accountId: string,
  eventUid: string,
  occurrenceStartAtMs: number
): Promise<void> {
  const db = await getAccountDb(accountId);
  db.prepare(
    `DELETE FROM calendar_participation_overrides
     WHERE accountId = ? AND eventUid = ? AND occurrenceStartAtMs = ?`
  ).run(accountId, eventUid, occurrenceStartAtMs);
}

export async function resolveCalendarParticipation(
  accountId: string,
  eventId: string,
  occurrenceStartAtMs?: number
): Promise<CalendarParticipationResolution> {
  const event = await getCalendarEventById(accountId, eventId);
  if (!event) {
    return {
      scope: "series",
      canRespond: false,
      isRecurring: false
    };
  }
  const isRecurring = Boolean(event.recurrenceRule?.trim());
  const canRespond = Boolean(event.rawIcs && event.myAttendeeEmail);
  if (!canRespond || !isRecurring || !Number.isFinite(occurrenceStartAtMs)) {
    return {
      partstat: event.myPartstat,
      scope: "series",
      canRespond,
      isRecurring
    };
  }
  const occurrenceOverride = await getCalendarParticipationOverrideForOccurrence(
    accountId,
    event.eventUid,
    occurrenceStartAtMs!
  );
  return {
    partstat: occurrenceOverride?.partstat ?? event.myPartstat,
    scope: occurrenceOverride ? "occurrence" : "series",
    canRespond,
    isRecurring,
    occurrenceStartAtMs
  };
}

export async function listCalendarEvents(
  accountId: string,
  rangeStartMs: number,
  rangeEndMs: number
): Promise<CalendarEvent[]> {
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT * FROM calendar_events
       WHERE accountId = ?
         AND deletedAtMs IS NULL
         AND startAtMs < ?
         AND (endAtMs IS NULL OR endAtMs >= ? OR (recurrenceRule IS NOT NULL AND recurrenceRule != ''))
       ORDER BY startAtMs ASC`
    )
    .all(accountId, rangeEndMs, rangeStartMs) as any[];
  return rows.map(rowToCalendarEvent);
}

export async function getCalendarEventById(
  accountId: string,
  eventId: string
): Promise<CalendarEvent | null> {
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(`SELECT * FROM calendar_events WHERE accountId = ? AND id = ?`)
    .get(accountId, eventId) as any;
  return row ? rowToCalendarEvent(row) : null;
}

export async function getCalendarEventByUid(
  accountId: string,
  eventUid: string
): Promise<CalendarEvent | null> {
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(
      `SELECT * FROM calendar_events WHERE accountId = ? AND eventUid = ? AND deletedAtMs IS NULL`
    )
    .get(accountId, eventUid) as any;
  return row ? rowToCalendarEvent(row) : null;
}

export async function upsertCalendarEventByUid(
  accountId: string,
  fields: Omit<CalendarEvent, "id" | "accountId" | "createdAtMs" | "updatedAtMs" | "deletedAtMs">
): Promise<CalendarEvent> {
  const existing = await getCalendarEventByUid(accountId, fields.eventUid);
  const now = Date.now();
  const event: CalendarEvent = {
    ...fields,
    accountId,
    id: existing?.id ?? `cal-${crypto.randomUUID()}`,
    createdAtMs: existing?.createdAtMs ?? now,
    updatedAtMs: now,
    deletedAtMs: undefined
  };
  await upsertCalendarEvent(accountId, event);
  return event;
}

export async function cancelCalendarEventByUid(
  accountId: string,
  eventUid: string
): Promise<void> {
  const db = await getAccountDb(accountId);
  db.prepare(
    `UPDATE calendar_events SET status = 'CANCELLED', updatedAtMs = ?
     WHERE accountId = ? AND eventUid = ? AND deletedAtMs IS NULL`
  ).run(Date.now(), accountId, eventUid);
}

export async function upsertCalendarEvent(
  accountId: string,
  event: CalendarEvent
): Promise<void> {
  const db = await getAccountDb(accountId);
  db.prepare(
    `INSERT OR REPLACE INTO calendar_events (
      id, accountId, calendarId, eventUid, summary, description, location,
      startAtMs, endAtMs, allDay, startTimezone, endTimezone,
      recurrenceRule, recurrenceDates, excludedDates,
      status, organizer, attendees, myPartstat, myPartstatUpdatedAtMs, myAttendeeEmail, replyRequested,
      remoteEtag, remoteHref, rawIcs, sourceType, messageId, occurrenceMessageIds, createdAtMs, updatedAtMs, deletedAtMs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    event.accountId,
    event.calendarId ?? null,
    event.eventUid,
    event.summary,
    event.description ?? null,
    event.location ?? null,
    event.startAtMs,
    event.endAtMs ?? null,
    event.allDay ? 1 : 0,
    event.startTimezone ?? null,
    event.endTimezone ?? null,
    event.recurrenceRule ?? null,
    event.recurrenceDates ? JSON.stringify(event.recurrenceDates) : null,
    event.excludedDates ? JSON.stringify(event.excludedDates) : null,
    event.status ?? null,
    event.organizer ?? null,
    event.attendees ?? null,
    event.myPartstat ?? null,
    event.myPartstatUpdatedAtMs ?? null,
    event.myAttendeeEmail ?? null,
    event.replyRequested == null ? null : (event.replyRequested ? 1 : 0),
    event.remoteEtag ?? null,
    event.remoteHref ?? null,
    event.rawIcs ?? null,
    event.sourceType,
    event.messageId ?? null,
    event.occurrenceMessageIds && Object.keys(event.occurrenceMessageIds).length > 0
      ? JSON.stringify(event.occurrenceMessageIds)
      : null,
    event.createdAtMs,
    event.updatedAtMs,
    event.deletedAtMs ?? null
  );
}

export async function updateCalendarEventMessageRelations(
  accountId: string,
  eventId: string,
  messageId: string | null,
  occurrenceMessageIds: Record<string, string> | undefined
): Promise<void> {
  return withDbWriteRetry("updateCalendarEventMessageRelations", async () => {
    const db = await getAccountDb(accountId);
    db.prepare(
      `UPDATE calendar_events
       SET messageId = ?, occurrenceMessageIds = ?, updatedAtMs = ?
       WHERE accountId = ? AND id = ?`
    ).run(
      messageId,
      occurrenceMessageIds && Object.keys(occurrenceMessageIds).length > 0
        ? JSON.stringify(occurrenceMessageIds)
        : null,
      Date.now(),
      accountId,
      eventId
    );
  });
}

export async function deleteCalendarEvent(
  accountId: string,
  eventId: string
): Promise<void> {
  const db = await getAccountDb(accountId);
  db.prepare(`DELETE FROM calendar_events WHERE accountId = ? AND id = ?`).run(accountId, eventId);
}

export async function softDeleteCalendarEvent(
  accountId: string,
  eventId: string
): Promise<void> {
  const db = await getAccountDb(accountId);
  db.prepare(
    `UPDATE calendar_events SET deletedAtMs = ? WHERE accountId = ? AND id = ?`
  ).run(Date.now(), accountId, eventId);
}

export async function listCalendarEventsBySource(
  accountId: string,
  sourceType: CalendarEventSourceType
): Promise<CalendarEvent[]> {
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT * FROM calendar_events
       WHERE accountId = ? AND sourceType = ? AND deletedAtMs IS NULL
       ORDER BY startAtMs ASC`
    )
    .all(accountId, sourceType) as any[];
  return rows.map(rowToCalendarEvent);
}
