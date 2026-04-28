import { randomUUID } from "crypto";
import type { InviteCode } from "../data";
import {
  collectCalendarInviteMutationGroups
} from "../calendarInviteProcessing";
import {
  extractEmailCalendarEventStatusFromIcs,
  normalizeCalendarEventStatus
} from "../calendarEventStatus";
import {
  mergeCalendarParticipation,
  normalizeCalendarParticipationStatus,
  resolveCalendarParticipationFromPreview
} from "../calendarParticipation";
import { normalizeCalendarEventUidKey } from "../calendarEventUids";
import { mapInviteRow } from "./rowParsers";

// WeakMap trackers + string signatures used to gate idempotent runtime
// schema / data ensures. Each DB connection is tracked once per process.
const calendarReminderSchemaSignatureByDb = new WeakMap<object, string>();
const messageCalendarEventSchemaSignatureByDb = new WeakMap<object, string>();
const threadSchemaSignatureByDb = new WeakMap<object, string>();
// Keyed on (db, accountId) so a shard shared by multiple accounts still
// back-fills each one separately. Under today's one-dbPath-per-account
// deployment the inner map has exactly one entry; this is defense in depth
// against future multi-account shards.
const calendarEventRuntimeSignatureByDb = new WeakMap<object, Map<string, string>>();
const topicSchemaSignatureByDb = new WeakMap<object, string>();

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
  "processedByUserId",
  "processedAutomatically",
  "unprocessedReason"
].join("|");
const THREAD_SCHEMA_SIGNATURE = ["latestReceivedDateValue"].join("|");
const TOPIC_SCHEMA_SIGNATURE = ["shortName"].join("|");
const CALENDAR_EVENT_RUNTIME_SIGNATURE = [
  "myPartstat",
  "myPartstatUpdatedAtMs",
  "myAttendeeEmail",
  "replyRequested",
  "occurrenceMessageIds",
  "emailStatusBackfillV1",
  "emailParticipationBackfillV1",
  "sourceEmailSnapshotColumnsV1",
  "sourceEmailSnapshotBackfillV1",
  "occurrenceSnapshotsColumnV1"
].join("|");

export function ensureCalendarReminderTableSchema(db: any) {
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

// PRAGMA doesn't accept bound parameters for identifiers, so the table
// name has to be interpolated. Keep the helper private and assert the
// identifier shape defensively — every caller in this file passes a
// constant string literal, but the guard rules out the injection footgun
// if that ever slips.
const TABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
function getDbTableColumns(db: any, tableName: string) {
  if (!TABLE_NAME_PATTERN.test(tableName)) {
    throw new Error(`Invalid SQLite table name: ${tableName}`);
  }
  return new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>).map((row) =>
      String(row.name ?? "")
    )
  );
}

export function ensureCalendarReminderOptionalColumns(db: any) {
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

export function ensureCalendarReminderRuntimeSchema(db: any) {
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

export function ensureMessageCalendarEventOptionalColumns(db: any) {
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
  if (!messageCalendarColumns.has("processedAutomatically")) {
    db.prepare(`ALTER TABLE message_calendar_events ADD COLUMN processedAutomatically INTEGER`).run();
  }
  if (!messageCalendarColumns.has("unprocessedReason")) {
    db.prepare(`ALTER TABLE message_calendar_events ADD COLUMN unprocessedReason TEXT`).run();
  }
  backfillMessageCalendarEventUidKeys(db);
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_message_calendar_events_account_uid_key
     ON message_calendar_events(accountId, eventUidKey)`
  ).run();
}

export function ensureMessageCalendarEventRuntimeSchema(db: any) {
  if (
    messageCalendarEventSchemaSignatureByDb.get(db) ===
    MESSAGE_CALENDAR_EVENT_SCHEMA_SIGNATURE
  ) {
    return;
  }
  ensureMessageCalendarEventOptionalColumns(db);
  messageCalendarEventSchemaSignatureByDb.set(db, MESSAGE_CALENDAR_EVENT_SCHEMA_SIGNATURE);
}

export function ensureThreadOptionalColumns(db: any) {
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

export function ensureThreadRuntimeSchema(db: any) {
  if (threadSchemaSignatureByDb.get(db) === THREAD_SCHEMA_SIGNATURE) {
    return;
  }
  ensureThreadOptionalColumns(db);
  threadSchemaSignatureByDb.set(db, THREAD_SCHEMA_SIGNATURE);
}

export function ensureTopicOptionalColumns(db: any) {
  const topicColumns = getDbTableColumns(db, "topics");
  if (topicColumns.size === 0) return;
  if (!topicColumns.has("shortName")) {
    db.prepare(`ALTER TABLE topics ADD COLUMN shortName TEXT`).run();
  }
}

export function ensureTopicRuntimeSchema(db: any) {
  if (topicSchemaSignatureByDb.get(db) === TOPIC_SCHEMA_SIGNATURE) {
    return;
  }
  ensureTopicOptionalColumns(db);
  topicSchemaSignatureByDb.set(db, TOPIC_SCHEMA_SIGNATURE);
}

export function ensureCalendarEventOptionalColumns(db: any) {
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
  // Source email snapshot columns (Topic 2, Calendar-Improvements.md).
  // These capture the standard fields of the email that spawned the event
  // so the snapshot survives deletion of the original message.
  if (!calendarEventColumns.has("sourceSubject")) {
    db.prepare(`ALTER TABLE calendar_events ADD COLUMN sourceSubject TEXT`).run();
  }
  if (!calendarEventColumns.has("sourceFromAddr")) {
    db.prepare(`ALTER TABLE calendar_events ADD COLUMN sourceFromAddr TEXT`).run();
  }
  if (!calendarEventColumns.has("sourceToAddr")) {
    db.prepare(`ALTER TABLE calendar_events ADD COLUMN sourceToAddr TEXT`).run();
  }
  if (!calendarEventColumns.has("sourceCcAddr")) {
    db.prepare(`ALTER TABLE calendar_events ADD COLUMN sourceCcAddr TEXT`).run();
  }
  if (!calendarEventColumns.has("sourceBccAddr")) {
    db.prepare(`ALTER TABLE calendar_events ADD COLUMN sourceBccAddr TEXT`).run();
  }
  if (!calendarEventColumns.has("sourceDateMs")) {
    db.prepare(`ALTER TABLE calendar_events ADD COLUMN sourceDateMs INTEGER`).run();
  }
  if (!calendarEventColumns.has("sourceBodyText")) {
    db.prepare(`ALTER TABLE calendar_events ADD COLUMN sourceBodyText TEXT`).run();
  }
  if (!calendarEventColumns.has("sourceBodyHtml")) {
    db.prepare(`ALTER TABLE calendar_events ADD COLUMN sourceBodyHtml TEXT`).run();
  }
  // Per-occurrence source email snapshots (Topic 2, Option C extension).
  // Stored as JSON keyed by occurrence startAtMs, mirroring occurrenceMessageIds.
  if (!calendarEventColumns.has("occurrenceSnapshots")) {
    db.prepare(`ALTER TABLE calendar_events ADD COLUMN occurrenceSnapshots TEXT`).run();
  }
}

// MIGRATION-CLEANUP:
// This back-fill is an idempotent migration. It populates the new source
// email snapshot columns on `calendar_events` rows created before the
// Topic 2 feature landed (Calendar-Improvements.md, Apr 2026). It handles
// BOTH the series-level `source*` columns (from `messageId`) and the
// per-occurrence `occurrenceSnapshots` JSON (from `occurrenceMessageIds`).
// Execution is gated by CALENDAR_EVENT_RUNTIME_SIGNATURE
// (sourceEmailSnapshotBackfillV1) only for the current runtime / DB
// connection (`calendarEventRuntimeSignatureByDb` is an in-process
// WeakMap and is not persisted per DB file), so this function may run
// again after a process restart or DB reopen. Re-runs are no-ops because
// the SELECT statements below only match rows still missing snapshot
// data. After a reasonable adoption window — once every running
// deployment has passed this runtime signature at least once — both this
// function and its call site in `ensureCalendarEventRuntimeData` should
// be deleted. Cleanup is tracked in
// https://github.com/paulwellnerbou/noctua-mail/issues/38.
function backfillCalendarEventSourceSnapshots(db: any) {
  const calendarEventColumns = getDbTableColumns(db, "calendar_events");
  if (calendarEventColumns.size === 0) return;
  if (
    !calendarEventColumns.has("sourceSubject") ||
    !calendarEventColumns.has("sourceFromAddr") ||
    !calendarEventColumns.has("sourceBodyText") ||
    !calendarEventColumns.has("occurrenceSnapshots")
  ) {
    return;
  }

  const selectMessage = db.prepare(
    `SELECT subject, fromAddr, toAddr, ccAddr, bccAddr, dateValue, body, htmlBody
     FROM messages
     WHERE id = ?`
  );

  // --- Step 1: back-fill series-level snapshot columns ---
  // Only touch rows that have a messageId but no series snapshot yet.
  const seriesRows = db
    .prepare(
      `SELECT id, messageId
       FROM calendar_events
       WHERE messageId IS NOT NULL
         AND TRIM(messageId) <> ''
         AND sourceSubject IS NULL
         AND sourceFromAddr IS NULL
         AND sourceToAddr IS NULL
         AND sourceCcAddr IS NULL
         AND sourceBccAddr IS NULL
         AND sourceDateMs IS NULL
         AND sourceBodyText IS NULL
         AND sourceBodyHtml IS NULL`
    )
    .all() as Array<{ id?: string | null; messageId?: string | null }>;

  const updateSeriesSnapshot = db.prepare(
    `UPDATE calendar_events
     SET sourceSubject = ?,
         sourceFromAddr = ?,
         sourceToAddr = ?,
         sourceCcAddr = ?,
         sourceBccAddr = ?,
         sourceDateMs = ?,
         sourceBodyText = ?,
         sourceBodyHtml = ?,
         updatedAtMs = ?
     WHERE id = ?`
  );

  // --- Step 2: back-fill per-occurrence snapshots JSON ---
  // Touch rows that have occurrenceMessageIds but no occurrenceSnapshots yet.
  const occurrenceRows = db
    .prepare(
      `SELECT id, occurrenceMessageIds
       FROM calendar_events
       WHERE occurrenceMessageIds IS NOT NULL
         AND TRIM(occurrenceMessageIds) <> ''
         AND occurrenceSnapshots IS NULL`
    )
    .all() as Array<{ id?: string | null; occurrenceMessageIds?: string | null }>;

  const updateOccurrenceSnapshots = db.prepare(
    `UPDATE calendar_events
     SET occurrenceSnapshots = ?,
         updatedAtMs = ?
     WHERE id = ?`
  );

  if (seriesRows.length === 0 && occurrenceRows.length === 0) return;

  const now = Date.now();

  type MessageRow = {
    subject?: string | null;
    fromAddr?: string | null;
    toAddr?: string | null;
    ccAddr?: string | null;
    bccAddr?: string | null;
    dateValue?: number | null;
    body?: string | null;
    htmlBody?: string | null;
  };

  function messageRowToSnapshotJson(msg: MessageRow): Record<string, unknown> {
    const snap: Record<string, unknown> = {};
    if (msg.subject != null) snap.sourceSubject = msg.subject;
    if (msg.fromAddr != null) snap.sourceFromAddr = msg.fromAddr;
    if (msg.toAddr != null) snap.sourceToAddr = msg.toAddr;
    if (msg.ccAddr != null) snap.sourceCcAddr = msg.ccAddr;
    if (msg.bccAddr != null) snap.sourceBccAddr = msg.bccAddr;
    if (typeof msg.dateValue === "number") snap.sourceDateMs = msg.dateValue;
    if (msg.body != null) snap.sourceBodyText = msg.body;
    if (msg.htmlBody != null) snap.sourceBodyHtml = msg.htmlBody;
    return snap;
  }

  const runBackfill = db.transaction(() => {
    // Step 1: series rows
    for (const row of seriesRows) {
      const id = String(row.id ?? "").trim();
      const messageId = String(row.messageId ?? "").trim();
      if (!id || !messageId) continue;
      const msg = selectMessage.get(messageId) as MessageRow | undefined;
      if (!msg) continue; // message no longer present — leave columns null
      updateSeriesSnapshot.run(
        msg.subject ?? null,
        msg.fromAddr ?? null,
        msg.toAddr ?? null,
        msg.ccAddr ?? null,
        msg.bccAddr ?? null,
        typeof msg.dateValue === "number" ? msg.dateValue : null,
        msg.body ?? null,
        msg.htmlBody ?? null,
        now,
        id
      );
    }
    // Step 2: per-occurrence snapshots
    for (const row of occurrenceRows) {
      const id = String(row.id ?? "").trim();
      const raw = String(row.occurrenceMessageIds ?? "").trim();
      if (!id || !raw) continue;
      let parsed: Record<string, unknown> | null = null;
      try {
        const candidate = JSON.parse(raw);
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
          parsed = candidate as Record<string, unknown>;
        }
      } catch {
        parsed = null;
      }
      if (!parsed) continue;
      const snapshots: Record<string, Record<string, unknown>> = {};
      for (const [occKey, messageIdRaw] of Object.entries(parsed)) {
        const messageId = typeof messageIdRaw === "string" ? messageIdRaw.trim() : "";
        if (!messageId) continue;
        const msg = selectMessage.get(messageId) as MessageRow | undefined;
        if (!msg) continue; // source message purged — skip this occurrence
        const snap = messageRowToSnapshotJson(msg);
        if (Object.keys(snap).length > 0) {
          snapshots[occKey] = snap;
        }
      }
      if (Object.keys(snapshots).length === 0) continue;
      updateOccurrenceSnapshots.run(JSON.stringify(snapshots), now, id);
    }
  });

  runBackfill();
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

function backfillEmailCalendarEventParticipation(
  db: any,
  accountId: string,
  accountEmail?: string | null
) {
  const normalizedAccountId = accountId?.trim();
  const normalizedAccountEmail = accountEmail?.trim();
  if (!normalizedAccountId || !normalizedAccountEmail) return;
  const rows = db
    .prepare(
      `SELECT id, eventUid, attendees, myPartstat, myPartstatUpdatedAtMs, myAttendeeEmail, replyRequested, rawIcs
       FROM calendar_events
       WHERE accountId = ?
         AND deletedAtMs IS NULL
         AND COALESCE(rawIcs, '') <> ''`
    )
    .all(normalizedAccountId) as Array<{
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

export async function ensureCalendarEventRuntimeData(db: any, accountId: string) {
  const perAccount = calendarEventRuntimeSignatureByDb.get(db);
  if (perAccount?.get(accountId) === CALENDAR_EVENT_RUNTIME_SIGNATURE) {
    return;
  }
  ensureCalendarEventOptionalColumns(db);
  backfillEmailCalendarEventStatuses(db);
  // Lazy import of the account lookup to avoid a top-level cycle with
  // lib/db.ts (which re-exports this module).
  const { getAccountById } = await import("../db");
  const account = await getAccountById(accountId);
  backfillEmailCalendarEventParticipation(db, accountId, account?.email);
  // MIGRATION-CLEANUP: one-off back-fill for the source email snapshot
  // columns (Topic 2). Remove alongside backfillCalendarEventSourceSnapshots
  // after the adoption window — tracked in
  // https://github.com/paulwellnerbou/noctua-mail/issues/38.
  backfillCalendarEventSourceSnapshots(db);
  const nextPerAccount = perAccount ?? new Map<string, string>();
  nextPerAccount.set(accountId, CALENDAR_EVENT_RUNTIME_SIGNATURE);
  if (!perAccount) calendarEventRuntimeSignatureByDb.set(db, nextPerAccount);
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

export function initMasterSchema(db: any) {
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

    CREATE TABLE IF NOT EXISTS mcp_tokens (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      createdByUserId TEXT NOT NULL,
      label TEXT NOT NULL,
      tokenHash TEXT NOT NULL UNIQUE,
      tokenSuffix TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      expiresAt INTEGER,
      lastUsedAt INTEGER
    );
  `);

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_mcp_tokens_account_created
     ON mcp_tokens(accountId, createdAt DESC)`
  ).run();

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

export function initAccountSchema(db: any) {
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
      pendingMoveSourceFolderId TEXT,
      pendingMoveSourceMailboxPath TEXT,
      pendingMoveSourceUid INTEGER,
      pendingMoveStartedAt INTEGER,
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
      processedAutomatically INTEGER,
      unprocessedReason TEXT,
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
      shortName TEXT,
      color TEXT NOT NULL,
      imapKeyword TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recipient_aliases (
      id TEXT PRIMARY KEY,
      accountId TEXT NOT NULL,
      name TEXT NOT NULL,
      recipients TEXT NOT NULL,
      normalizedRecipients TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS topic_signal_exclusions (
      accountId TEXT NOT NULL,
      topicId TEXT NOT NULL,
      signalType TEXT NOT NULL,
      signalValue TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      PRIMARY KEY (accountId, topicId, signalType, signalValue)
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
    -- Expression index for from:<term> searches. buildAddressSearchClause
    -- emits lower(COALESCE(fromAddr, '')) LIKE ?; the indexed expression
    -- must match the WHERE expression character-for-character for SQLite
    -- to use it. With this index the planner does a per-account index
    -- scan on the precomputed lowered value (~13x faster on a 7k-row DB)
    -- instead of a full-table scan that re-evaluates lower(COALESCE(...))
    -- per row.
    --
    -- Deliberately not adding analogous indexes for toAddr/ccAddr/bccAddr:
    -- recipient/participant searches OR across multiple columns, and
    -- SQLite's planner does not match expression-index expressions to
    -- WHERE expressions when picking between equally-narrowing indexes.
    -- With multiple competing expression indexes the planner picks the
    -- smallest one (typically bcc, mostly NULL), which doesn't match the
    -- column being filtered, and the LIKE falls back to per-row
    -- evaluation. Improving recipient/participant search needs an FTS5
    -- redesign, not more expression indexes — see CLEANUP/pass4-risk.md.
    --
    -- Also: do not run ANALYZE on this table without re-validating; with
    -- selectivity stats present, the planner prefers a full SCAN over
    -- this index because LIKE '%term%' cannot use it for a seek.
    CREATE INDEX IF NOT EXISTS idx_messages_account_from_lower
      ON messages(accountId, lower(COALESCE(fromAddr, '')));
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
    CREATE INDEX IF NOT EXISTS idx_recipient_aliases_account
      ON recipient_aliases(accountId);
    CREATE INDEX IF NOT EXISTS idx_recipient_aliases_account_normalized_recipients
      ON recipient_aliases(accountId, normalizedRecipients);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_recipient_aliases_account_name
      ON recipient_aliases(accountId, lower(name));
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
    CREATE INDEX IF NOT EXISTS idx_topic_signal_exclusions_account_topic
      ON topic_signal_exclusions(accountId, topicId);
    CREATE INDEX IF NOT EXISTS idx_topic_signal_exclusions_account_signal
      ON topic_signal_exclusions(accountId, signalType, signalValue, topicId);

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
      sourceSubject TEXT,
      sourceFromAddr TEXT,
      sourceToAddr TEXT,
      sourceCcAddr TEXT,
      sourceBccAddr TEXT,
      sourceDateMs INTEGER,
      sourceBodyText TEXT,
      sourceBodyHtml TEXT,
      occurrenceSnapshots TEXT,
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
  if (!messageColumns.has("pendingMoveSourceFolderId")) {
    db.prepare(`ALTER TABLE messages ADD COLUMN pendingMoveSourceFolderId TEXT`).run();
  }
  if (!messageColumns.has("pendingMoveSourceMailboxPath")) {
    db.prepare(`ALTER TABLE messages ADD COLUMN pendingMoveSourceMailboxPath TEXT`).run();
  }
  if (!messageColumns.has("pendingMoveSourceUid")) {
    db.prepare(`ALTER TABLE messages ADD COLUMN pendingMoveSourceUid INTEGER`).run();
  }
  if (!messageColumns.has("pendingMoveStartedAt")) {
    db.prepare(`ALTER TABLE messages ADD COLUMN pendingMoveStartedAt INTEGER`).run();
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_account_pending_move_source
      ON messages(accountId, pendingMoveSourceFolderId, pendingMoveSourceUid);
    CREATE INDEX IF NOT EXISTS idx_messages_account_pending_move_destination
      ON messages(accountId, folderId, pendingMoveSourceFolderId);
  `);
  ensureThreadOptionalColumns(db);
  ensureTopicOptionalColumns(db);
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
