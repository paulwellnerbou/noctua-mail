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
  CalendarReminder,
  Folder,
  InviteCode,
  MailboxState,
  Message,
  User
} from "./data";
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
import { normalizeAccountDateFormat } from "./dateFormatting";
import { withDbWriteRetry } from "./dbWriteRetry";
import { createHash, randomUUID } from "crypto";
import { normalizeReminderDateList, resolveNextReminderOccurrence } from "./reminderRecurrence";
import { resolveCalendarTimeZoneId } from "./calendarTimezones";
import { collectCalendarReminderMutationsFromCalendarInvite } from "./calendarReminderMutations";
import type { CalendarReminderMutation } from "./calendarReminderMutations";
import { getAttachmentContentBuffer } from "./mail/syncMessageSanitizer";
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
const calendarReminderSchemaEnsuredByDb = new WeakSet<object>();
const ACCOUNT_DB_IDLE_MS = (() => {
  const raw = process.env.ACCOUNT_DB_IDLE_MS?.trim();
  if (!raw) return 5 * 60 * 1000; // 5 minutes: releases SQLite page cache sooner after syncs
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 5 * 60 * 1000;
  return parsed;
})();
let shutdownHooksRegistered = false;

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
  if (calendarReminderSchemaEnsuredByDb.has(db)) return;
  ensureCalendarReminderOptionalColumns(db);
  calendarReminderSchemaEnsuredByDb.add(db);
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
      categoryManualState TEXT
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
      PRIMARY KEY (accountId, messageId, eventUid),
      FOREIGN KEY(messageId) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS threads (
      threadId TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      rootMessageId TEXT,
      latestMessageId TEXT,
      latestDateValue INTEGER,
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
  if (!messageColumns.has("xComposeFormat")) {
    db.prepare(`ALTER TABLE messages ADD COLUMN xComposeFormat TEXT`).run();
  }
  if (!messageColumns.has("quotedHtmlEdited")) {
    db.prepare(`ALTER TABLE messages ADD COLUMN quotedHtmlEdited INTEGER DEFAULT 0`).run();
  }

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
  ensureCalendarReminderRuntimeSchema(accountDb);
  scheduleAccountDbIdleClose(dbPath);
  return accountDb;
}

export type GroupMeta = { key: string; label: string; count: number };

function resolveAccountDbPathForPersist(accountId: string, dbPath?: string | null) {
  if (dbPath && dbPath.trim().length > 0) return dbPath;
  return getDefaultAccountDbPath(accountId);
}

function mapAccountRow(row: any): Account {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    avatar: row.avatar,
    settings: normalizeAccountSettings(row.settings ? (JSON.parse(row.settings) as any) : undefined),
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
  return {
    ...current,
    ...payload,
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
      smtpHost, smtpPort, smtpSecure, smtpUser, smtpPassword
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    shouldStorePasswordInDb() ? encodeSecret(account.smtp.password) : ""
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

function normalizeAccountSettings(settings?: AccountSettings) {
  const next: AccountSettings = settings ? JSON.parse(JSON.stringify(settings)) : {};
  if (!next.threading) next.threading = {};
  if (next.threading.includeAcrossFolders === undefined) {
    next.threading.includeAcrossFolders = true;
  }
  if (!next.layout) next.layout = {};
  if (!next.layout.defaultView) {
    next.layout.defaultView = "threads";
  }
  if (!next.appearance) next.appearance = {};
  next.appearance.dateFormat = normalizeAccountDateFormat(next.appearance.dateFormat);
  if (!next.signatures) next.signatures = [];
  if (next.defaultSignatureId === undefined) {
    next.defaultSignatureId = "";
  }
  return next;
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
        threadId, accountId, rootMessageId, latestMessageId, latestDateValue, messageCount, unreadCount
      )
      SELECT
        m.threadId as threadId,
        m.accountId as accountId,
        (SELECT id FROM messages m2 WHERE m2.accountId = m.accountId AND m2.threadId = m.threadId ORDER BY m2.dateValue ASC LIMIT 1) as rootMessageId,
        (SELECT id FROM messages m3 WHERE m3.accountId = m.accountId AND m3.threadId = m.threadId ORDER BY m3.dateValue DESC LIMIT 1) as latestMessageId,
        MAX(m.dateValue) as latestDateValue,
        COUNT(*) as messageCount,
        SUM(CASE WHEN m.unread = 1 THEN 1 ELSE 0 END) as unreadCount
      FROM messages m
      WHERE m.accountId = ? AND m.threadId IN (${placeholders})
      GROUP BY m.threadId, m.accountId
    `
    ).run(accountId, ...unique);
    return;
  }
  db.prepare(`DELETE FROM threads WHERE accountId = ?`).run(accountId);
  db.prepare(
    `
    INSERT OR REPLACE INTO threads (
      threadId, accountId, rootMessageId, latestMessageId, latestDateValue, messageCount, unreadCount
    )
    SELECT
      m.threadId as threadId,
      m.accountId as accountId,
      (SELECT id FROM messages m2 WHERE m2.accountId = m.accountId AND m2.threadId = m.threadId ORDER BY m2.dateValue ASC LIMIT 1) as rootMessageId,
      (SELECT id FROM messages m3 WHERE m3.accountId = m.accountId AND m3.threadId = m.threadId ORDER BY m3.dateValue DESC LIMIT 1) as latestMessageId,
      MAX(m.dateValue) as latestDateValue,
      COUNT(*) as messageCount,
      SUM(CASE WHEN m.unread = 1 THEN 1 ELSE 0 END) as unreadCount
    FROM messages m
    WHERE m.accountId = ?
    GROUP BY m.threadId, m.accountId
  `
  ).run(accountId);
}

export async function recomputeThreadsForAccount(accountId: string, threadIds?: string[]) {
  return withDbWriteRetry("recomputeThreadsForAccount", () =>
    recomputeThreadsForAccountInternal(accountId, threadIds)
  );
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
    const byMessageId = new Map<string, (typeof rows)[number]>();
    const byId = new Map<string, (typeof rows)[number]>();
    rows.forEach((row) => {
      byId.set(row.id, row);
      if (row.messageId) {
        const existing = byMessageId.get(row.messageId);
        if (!existing || row.dateValue < existing.dateValue) {
          byMessageId.set(row.messageId, row);
        }
      }
    });
    const parentCache = new Map<string, string | null>();
    const resolveParentId = (msg: (typeof rows)[number]) => {
      if (parentCache.has(msg.id)) return parentCache.get(msg.id)!;
      let resolved: string | null = null;
      if (msg.inReplyTo && byMessageId.has(msg.inReplyTo)) {
        resolved = byMessageId.get(msg.inReplyTo)!.id;
      } else {
        const refs = parseReferences(msg.references) ?? [];
        for (let i = refs.length - 1; i >= 0; i -= 1) {
          const ref = refs[i];
          if (byMessageId.has(ref)) {
            resolved = byMessageId.get(ref)!.id;
            break;
          }
        }
      }
      if (resolved === msg.id) resolved = null;
      parentCache.set(msg.id, resolved);
      return resolved;
    };
    const threadCache = new Map<string, string>();
    const resolveThreadId = (msg: (typeof rows)[number], stack: Set<string>): string => {
      if (threadCache.has(msg.id)) return threadCache.get(msg.id)!;
      if (stack.has(msg.id)) {
        const fallback = msg.messageId ?? msg.threadId ?? msg.id;
        threadCache.set(msg.id, fallback);
        return fallback;
      }
      stack.add(msg.id);
      const parentId = resolveParentId(msg);
      let resolved: string | undefined;
      if (parentId && byId.has(parentId)) {
        resolved = resolveThreadId(byId.get(parentId)!, stack);
      } else if (msg.messageId) {
        resolved = msg.messageId;
      } else if (msg.threadId) {
        resolved = msg.threadId;
      } else {
        resolved = msg.id;
      }
      stack.delete(msg.id);
      threadCache.set(msg.id, resolved);
      return resolved;
    };
    const updates: Array<{ id: string; threadId: string; parentId: string | null }> = [];
    rows.forEach((row) => {
      const nextParentId = resolveParentId(row);
      const nextThreadId = resolveThreadId(row, new Set());
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
  const normalizedUid = normalizeReminderEventUid(uid ?? undefined)?.toLowerCase() ?? "";
  if (!normalizedUid) return null;
  const atIndex = normalizedUid.indexOf("@");
  const localPart = atIndex >= 0 ? normalizedUid.slice(0, atIndex) : normalizedUid;
  const domainPart = atIndex >= 0 ? normalizedUid.slice(atIndex) : "";
  const strippedLocalPart = localPart.replace(/_r\d{8}t\d{6}z?$/i, "");
  const key = `${strippedLocalPart || localPart}${domainPart}`.trim();
  return key || null;
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

  const matchingRows = eventUid
    ? (db
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
        .all(accountId, userId, eventUidKey, eventStartAtMs, eventTitle) as Array<{
        id: string;
        createdAtMs: number;
        messageId?: string | null;
      }>)
    : (db
        .prepare(
          `SELECT id, createdAtMs, messageId
           FROM calendar_reminders
           WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL
             AND eventStartAtMs = ?
             AND lower(eventTitle) = lower(?)
           ORDER BY createdAtMs ASC`
        )
        .all(accountId, userId, eventStartAtMs, eventTitle) as Array<{
        id: string;
        createdAtMs: number;
        messageId?: string | null;
      }>);

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

function buildGroupKey(message: Message, groupBy: string) {
  const date = new Date(message.dateValue);
  if (groupBy === "date") {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;
    if (message.dateValue >= todayStart) return "Today";
    if (message.dateValue >= yesterdayStart) return "Yesterday";
    if (message.dateValue >= weekStart) return "This Week";
    return "Older";
  }
  if (groupBy === "week") {
    const year = date.getFullYear();
    const week = Math.ceil(
      ((date.getTime() - new Date(year, 0, 1).getTime()) / 86400000 + 1) / 7
    );
    return `${year}-W${String(week).padStart(2, "0")}`;
  }
  if (groupBy === "year") return String(date.getFullYear());
  if (groupBy === "domain") {
    const emailMatch = message.from.match(/<([^>]+)>/);
    const email = emailMatch ? emailMatch[1] : message.from;
    const domain = email.split("@")[1];
    return domain ? domain.toLowerCase() : "Unknown";
  }
  if (groupBy === "sender") return message.from;
  if (groupBy === "folder") return message.folderId;
  return "All";
}

function buildGroupLabel(key: string, groupBy: string) {
  if (groupBy === "none") return "All";
  return key;
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

  const rawQuery = withoutInviteUid.trim();
  const queryTokens = buildSearchTokens(withoutInviteUid);
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

function normalizeCalendarEventUid(value?: string | null) {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized || null;
}

function normalizeCalendarEventUids(values?: Array<string | null | undefined> | null) {
  if (!Array.isArray(values) || values.length === 0) return [];
  return Array.from(
    new Set(
      values
        .map((value) => normalizeCalendarEventUid(value))
        .filter((value): value is string => Boolean(value))
    )
  );
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

function isSameMailboxMessageCopy(
  existing: { folderId?: string | null; mailboxPath?: string | null; imapUid?: number | null },
  incoming: Pick<Message, "folderId" | "mailboxPath" | "imapUid">
) {
  if (existing.folderId && incoming.folderId && existing.folderId !== incoming.folderId) {
    return false;
  }
  const existingUid =
    typeof existing.imapUid === "number" && Number.isFinite(existing.imapUid)
      ? existing.imapUid
      : null;
  const incomingUid =
    typeof incoming.imapUid === "number" && Number.isFinite(incoming.imapUid)
      ? incoming.imapUid
      : null;
  if (existingUid !== null && incomingUid !== null) {
    return existingUid === incomingUid;
  }
  const existingMailbox = (existing.mailboxPath ?? "").trim().toLowerCase();
  const incomingMailbox = (incoming.mailboxPath ?? "").trim().toLowerCase();
  if (existingMailbox && incomingMailbox) {
    return existingMailbox === incomingMailbox;
  }
  return true;
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

  const { ftsTokenQueries, fromTerms, toTerms, inTerms, inviteUidTerms, rawQuery, attachmentFilenameTerms } = parseSearchInput(
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
  inviteUidTerms.forEach(() => {
    where += ` AND EXISTS (
      SELECT 1
      FROM message_calendar_events mce
      WHERE mce.accountId = ?
        AND mce.messageId = m.id
        AND lower(mce.eventUid) LIKE ?
    )`;
  });
  inviteUidTerms.forEach((term) => {
    args.push(accountId, `%${term}%`);
  });
  where = applyBadgeFilters(where, args, badges);
  where = applyExcludedFolderFilters(where, args, excludedFolderIds);
  const attachmentsFilter = attachmentsOnly ?? badges?.includes("attachments");
  if (attachmentsFilter) {
    where += ` AND ${buildMeaningfulAttachmentExistsSql("m")}`;
  }

  if (groupBy === "date") {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;
    const rows = db
      .prepare(
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
      `
      )
      .all(todayStart, yesterdayStart, weekStart, ...args) as Array<{ key: string; count: number }>;
    const order = ["Today", "Yesterday", "This Week", "Older"];
    rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return groupsFromRows(rows, groupBy);
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

  const { ftsTokenQueries, fromTerms, toTerms, inTerms, inviteUidTerms, rawQuery, attachmentFilenameTerms } = parseSearchInput(
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
  inviteUidTerms.forEach(() => {
    where += ` AND EXISTS (
      SELECT 1
      FROM message_calendar_events mce
      WHERE mce.accountId = ?
        AND mce.messageId = m.id
        AND lower(mce.eventUid) LIKE ?
    )`;
  });
  inviteUidTerms.forEach((term) => {
    args.push(accountId, `%${term}%`);
  });
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
  const targetCalendarEventUids = normalizeCalendarEventUids(
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
  if (targetCalendarEventUids.length > 0) {
    clauses.push(
      `m.id IN (
         SELECT mce.messageId
         FROM message_calendar_events mce
         WHERE mce.accountId = ?
           AND mce.eventUid IN (${targetCalendarEventUids.map(() => "?").join(",")})
       )`
    );
    args.push(accountId, ...targetCalendarEventUids);
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
    targetCalendarEventUids.length === 0
      ? new Set<string>()
      : new Set(
          (
            db
              .prepare(
                `SELECT DISTINCT messageId
                 FROM message_calendar_events
                 WHERE accountId = ?
                   AND eventUid IN (${targetCalendarEventUids.map(() => "?").join(",")})`
              )
              .all(accountId, ...targetCalendarEventUids) as Array<{ messageId?: string | null }>
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
      listUnsubscribe: row.listUnsubscribe ?? undefined
    };
    (message as any).groupKey = buildGroupKey(message, groupBy);
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
      to: row.toAddr,
      preview: row.preview,
      date: row.date,
      dateValue: row.dateValue,
      body: ""
    } as Message;
    const key = buildGroupKey(message, groupBy);
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
  });

  const groupRows = Array.from(groupCounts.entries()).map(([key, count]) => ({
    key,
    count
  }));
  if (groupBy === "date") {
    const order = ["Today", "Yesterday", "This Week", "Older"];
    groupRows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
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

  const { ftsTokenQueries, fromTerms, toTerms, inTerms, inviteUidTerms, rawQuery, attachmentFilenameTerms } = parseSearchInput(
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
  inviteUidTerms.forEach(() => {
    where += ` AND EXISTS (
      SELECT 1
      FROM message_calendar_events mce
      WHERE mce.accountId = ?
        AND mce.messageId = m.id
        AND lower(mce.eventUid) LIKE ?
    )`;
  });
  inviteUidTerms.forEach((term) => {
    args.push(accountId, `%${term}%`);
  });
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
      listUnsubscribe: row.listUnsubscribe ?? undefined
    };
    (message as any).groupKey = buildGroupKey(message, groupBy);
    return message;
  });

  const groups = await getGroupCounts({
    accountId,
    folderId,
    query: query ?? undefined,
    groupBy,
    fields,
    badges,
    attachmentsOnly,
    excludedFolderIds
  });
  const total = await getTotalCount({
    accountId,
    folderId,
    query: query ?? undefined,
    fields,
    badges,
    attachmentsOnly,
    excludedFolderIds
  });
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

  const { ftsTokenQueries, fromTerms, toTerms, inTerms, inviteUidTerms, rawQuery, attachmentFilenameTerms } = parseSearchInput(
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
  inviteUidTerms.forEach(() => {
    where += ` AND EXISTS (
      SELECT 1
      FROM message_calendar_events mce
      WHERE mce.accountId = ?
        AND mce.messageId = m.id
        AND lower(mce.eventUid) LIKE ?
    )`;
  });
  inviteUidTerms.forEach((term) => {
    args.push(accountId, `%${term}%`);
  });
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
    (badges?.length ?? 0) === 0 &&
    !attachmentsFilter &&
    normalizedExcludedFolderIds.length === 0;

  let threadRows: any[] = [];
  let threadTotal = 0;
  let total = 0;
  let baseCount = 0;

  if (isUnfilteredThreadList) {
    if (shouldPrioritizeFlaggedThreads) {
      threadRows = db
        .prepare(
          `
          SELECT t.*
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
            t.latestDateValue DESC
          LIMIT ? OFFSET ?
        `
        )
        .all(accountId, accountId, pageSize, offset) as any[];
    } else {
      threadRows = db
        .prepare(
          `
          SELECT t.*
          FROM threads t
          WHERE t.accountId = ?
            AND EXISTS (
              SELECT 1
              FROM messages m
              WHERE m.accountId = t.accountId
                AND m.threadId = t.threadId
                AND COALESCE(m.deleted, 0) = 0
            )
          ORDER BY t.latestDateValue DESC
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
    let threadOrderSql = "t.latestDateValue DESC";
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
        "CASE WHEN flaggedThreads.threadId IS NULL THEN 0 ELSE 1 END DESC, t.latestDateValue DESC";
    }

    threadRows = db
      .prepare(
        `
        SELECT t.*
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

    total = await getTotalCount({
      accountId,
      folderId,
      query: query ?? undefined,
      fields,
      badges,
      attachmentsOnly,
      excludedFolderIds
    });

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
      listUnsubscribe: row.listUnsubscribe ?? undefined
    };
    (message as any).groupKey = buildGroupKey(message, groupBy);
    return message;
  });

  const groups = await getGroupCounts({
    accountId,
    folderId,
    query: query ?? undefined,
    groupBy,
    fields,
    badges,
    attachmentsOnly,
    excludedFolderIds
  });

  const hasMore = offset + threadRows.length < threadTotal;
  return { items, groups, total, hasMore, baseCount };
}

export async function listThreadMessages(params: {
  accountId: string;
  threadIds: string[];
  messageIds?: string[];
  groupBy?: string;
}) {
  const { accountId, threadIds, messageIds = [], groupBy = "date" } = params;
  const uniqueThreads = Array.from(new Set(threadIds.filter(Boolean)));
  const uniqueMessages = Array.from(new Set(messageIds.filter(Boolean)));
  if (uniqueThreads.length === 0 && uniqueMessages.length === 0) {
    return { items: [] as Message[] };
  }
  const db = await getAccountDb(accountId);
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

  const ids = rows.map((row) => row.id);
  const attachmentRows =
    ids.length > 0
      ? (db
          .prepare(
            `SELECT * FROM attachments WHERE messageId IN (${ids.map(() => "?").join(",")})`
          )
          .all(...ids) as any[])
      : [];

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
      listUnsubscribe: row.listUnsubscribe ?? undefined
    };
    (message as any).groupKey = buildGroupKey(message, groupBy);
    return message;
  });

  return { items };
}

export async function getThreadIdsByMessageIds(accountId: string, messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, string>();
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT messageId, threadId FROM messages WHERE accountId = ? AND messageId IN (${messageIds
        .map(() => "?")
        .join(",")})`
    )
    .all(accountId, ...messageIds) as Array<{ messageId: string; threadId: string }>;
  const map = new Map<string, string>();
  rows.forEach((row) => {
    if (row.messageId && row.threadId) {
      map.set(row.messageId, row.threadId);
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
      `INSERT OR REPLACE INTO message_calendar_events (accountId, messageId, eventUid)
       VALUES (?, ?, ?)`
    );

    const insertMessage = db.prepare(`
      INSERT OR REPLACE INTO messages (
        id, accountId, folderId, threadId, parentId, messageId, inReplyTo, "references", xForwardedMessageId, xComposeFormat, quotedHtmlEdited,
        subject, fromAddr, fromEmail, toAddr, ccAddr, bccAddr, mailboxPath, imapUid, preview, date, dateValue,
        body, htmlBody, priority, hasSource, unread, flags, seen, answered, flagged, deleted, draft, recent,
        category, categoryScore, categorySignals, categoryManualState, listUnsubscribe
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          message.listUnsubscribe ?? null
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
          insertCalendarEvent.run(accountId, rowId, eventUid);
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
        return { affectedThreadIds: affected, requiresFullRecompute };
      }
      requiresFullRecompute = true;
      if (shouldRecomputeThreads) {
        await recomputeThreadsForAccountInternal(accountId);
      }
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
    }
    return { affectedThreadIds, requiresFullRecompute };
  });
}

export async function getMessageById(accountId: string, messageId: string) {
  const db = await getAccountDb(accountId);
  const normalizedLookup = messageId.trim();
  let row = db
    .prepare(`SELECT * FROM messages WHERE accountId = ? AND id = ?`)
    .get(accountId, normalizedLookup) as any;
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
    listUnsubscribe: row.listUnsubscribe ?? undefined
  } as Message;
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
