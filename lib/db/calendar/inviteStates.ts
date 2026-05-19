/**
 * Writers (and a handful of reads) for the `message_calendar_events` table —
 * the per-message invite state that links a message to one or more calendar
 * events by UID and tracks whether the invite has been processed.
 *
 * Reads that are embedded in message listings live in `../messages/_shared`
 * (hydration of the invite-state rows). The writers here maintain those rows
 * independently so the messages layer never has to touch invite writes.
 */
import { getAccountDb } from "../connection";
import { withDbWriteRetry } from "../../dbWriteRetry";
import {
  type CalendarInviteActionType,
  type CalendarInviteUnprocessedReason
} from "../../calendarInviteProcessing";
import {
  normalizeCalendarEventUid,
  normalizeCalendarEventUidKey,
  normalizeCalendarEventUidKeys
} from "../../calendarEventUids";
import {
  itemsFromUniqueInviteStates,
  normalizeCalendarInviteActionType,
  normalizeCalendarInviteUnprocessedReason
} from "../messages/_shared";

export async function upsertMessageCalendarInviteStates(
  accountId: string,
  messageId: string,
  states: Array<{
    eventUid: string;
    actionType: CalendarInviteActionType;
    eventFirstStartAtMs?: number;
    eventLastEndAtMs?: number | null;
    snapshotJson?: string | null;
    snapshotVersion?: number | null;
  }>
) {
  return withDbWriteRetry("upsertMessageCalendarInviteStates", async () => {
    const db = await getAccountDb(accountId);
    const insert = db.prepare(
      `INSERT INTO message_calendar_events (
         accountId,
         messageId,
         eventUid,
         eventUidKey,
         eventFirstStartAtMs,
         eventLastEndAtMs,
         inviteActionType,
         snapshotJson,
         snapshotVersion
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(accountId, messageId, eventUid)
       DO UPDATE SET
         eventUidKey = excluded.eventUidKey,
         eventFirstStartAtMs = excluded.eventFirstStartAtMs,
         eventLastEndAtMs = excluded.eventLastEndAtMs,
         inviteActionType = excluded.inviteActionType,
         snapshotJson = COALESCE(excluded.snapshotJson, snapshotJson),
         snapshotVersion = COALESCE(excluded.snapshotVersion, snapshotVersion)`
    );
    const apply = db.transaction(
      (
        items: Array<{
          eventUid: string;
          actionType: CalendarInviteActionType;
          eventFirstStartAtMs?: number;
          eventLastEndAtMs?: number | null;
          snapshotJson?: string | null;
          snapshotVersion?: number | null;
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
            typeof item.eventLastEndAtMs === "number" &&
            Number.isFinite(item.eventLastEndAtMs) &&
            item.eventLastEndAtMs > 0
              ? Math.round(item.eventLastEndAtMs)
              : null;
          const snapshotJson =
            typeof item.snapshotJson === "string" && item.snapshotJson.trim()
              ? item.snapshotJson
              : null;
          const snapshotVersion =
            typeof item.snapshotVersion === "number" &&
            Number.isFinite(item.snapshotVersion)
              ? Math.round(item.snapshotVersion)
              : null;
          insert.run(
            accountId,
            messageId,
            eventUid,
            eventUidKey,
            eventFirstStartAtMs,
            eventLastEndAtMs,
            actionType,
            snapshotJson,
            snapshotVersion
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
  options?: {
    processedAtMs?: number | null;
    processedByUserId?: string | null;
    processedAutomatically?: boolean | null;
  }
) {
  return withDbWriteRetry("markMessageCalendarInviteStatesProcessed", async () => {
    const db = await getAccountDb(accountId);
    // Match by canonical UID key. A series and its individual occurrences
    // can carry different `eventUid` values but share the same
    // `eventUidKey`; matching bare `eventUid` would silently miss
    // occurrence-scoped rows of the same series.
    const normalizedEventUidKeys = normalizeCalendarEventUidKeys(eventUids);
    if (normalizedEventUidKeys.length === 0) return 0;
    const processedAtMs =
      typeof options?.processedAtMs === "number" &&
      Number.isFinite(options.processedAtMs) &&
      options.processedAtMs > 0
        ? Math.round(options.processedAtMs)
        : Date.now();
    const processedByUserId =
      typeof options?.processedByUserId === "string" && options.processedByUserId.trim()
        ? options.processedByUserId.trim()
        : null;
    const processedAutomatically =
      typeof options?.processedAutomatically === "boolean"
        ? (options.processedAutomatically ? 1 : 0)
        : null;
    // Callers can pass more eventUidKeys than SQLite's default
    // 999-parameter limit allows in a single statement. Chunk at the
    // shared QUERY_BATCH_SIZE used by the messages domain.
    const QUERY_BATCH_SIZE = 400;
    let totalChanges = 0;
    for (let start = 0; start < normalizedEventUidKeys.length; start += QUERY_BATCH_SIZE) {
      const chunk = normalizedEventUidKeys.slice(start, start + QUERY_BATCH_SIZE);
      const result = db
        .prepare(
          `UPDATE message_calendar_events
           SET processedAtMs = ?,
               processedByUserId = ?,
               processedAutomatically = ?,
               unprocessedReason = NULL
           WHERE accountId = ?
             AND messageId = ?
             AND lower(COALESCE(eventUidKey, eventUid, '')) IN (${chunk.map(() => "?").join(",")})`
        )
        .run(
          processedAtMs,
          processedByUserId,
          processedAutomatically,
          accountId,
          messageId,
          ...chunk
        ) as { changes?: number };
      totalChanges += result?.changes ?? 0;
    }
    return totalChanges;
  });
}

export async function markMessageCalendarInviteStatesUnprocessed(
  accountId: string,
  messageId: string,
  eventUids: string[],
  reason: CalendarInviteUnprocessedReason
) {
  return withDbWriteRetry("markMessageCalendarInviteStatesUnprocessed", async () => {
    const normalizedReason = normalizeCalendarInviteUnprocessedReason(reason);
    if (!normalizedReason) return 0;
    const db = await getAccountDb(accountId);
    const normalizedEventUidKeys = normalizeCalendarEventUidKeys(eventUids);
    if (normalizedEventUidKeys.length === 0) return 0;
    const QUERY_BATCH_SIZE = 400;
    let totalChanges = 0;
    for (let start = 0; start < normalizedEventUidKeys.length; start += QUERY_BATCH_SIZE) {
      const chunk = normalizedEventUidKeys.slice(start, start + QUERY_BATCH_SIZE);
      const result = db
        .prepare(
          `UPDATE message_calendar_events
           SET processedAtMs = NULL,
               processedByUserId = NULL,
               processedAutomatically = NULL,
               unprocessedReason = ?
           WHERE accountId = ?
             AND messageId = ?
             AND lower(COALESCE(eventUidKey, eventUid, '')) IN (${chunk.map(() => "?").join(",")})`
        )
        .run(normalizedReason, accountId, messageId, ...chunk) as { changes?: number };
      totalChanges += result?.changes ?? 0;
    }
    return totalChanges;
  });
}

export async function clearMessageCalendarInviteStatesProcessedByEventUid(
  accountId: string,
  eventUid: string
) {
  return withDbWriteRetry("clearMessageCalendarInviteStatesProcessedByEventUid", async () => {
    const db = await getAccountDb(accountId);
    // Canonical key match — see `markMessageCalendarInviteStatesProcessed`
    // for the rationale: series and occurrence rows share the same
    // `eventUidKey` even when their `eventUid`s differ.
    const normalizedEventUidKey = normalizeCalendarEventUidKey(eventUid);
    if (!normalizedEventUidKey) return 0;
    const result = db
      .prepare(
        `UPDATE message_calendar_events
         SET processedAtMs = NULL,
             processedByUserId = NULL,
             processedAutomatically = NULL,
             unprocessedReason = NULL
         WHERE accountId = ? AND lower(COALESCE(eventUidKey, eventUid, '')) = lower(?)`
      )
      .run(accountId, normalizedEventUidKey) as { changes?: number };
    return result?.changes ?? 0;
  });
}

export async function listFullyProcessedCalendarInviteMessageIds(
  accountId: string,
  messageIds: string[]
): Promise<string[]> {
  const db = await getAccountDb(accountId);
  const normalizedMessageIds = Array.from(
    new Set(
      messageIds
        .map((messageId) => String(messageId ?? "").trim())
        .filter(Boolean)
    )
  );
  if (normalizedMessageIds.length === 0) return [];

  const QUERY_BATCH_SIZE = 400;
  const processedMessageIds = new Set<string>();

  for (let start = 0; start < normalizedMessageIds.length; start += QUERY_BATCH_SIZE) {
    const chunk = normalizedMessageIds.slice(start, start + QUERY_BATCH_SIZE);
    if (chunk.length === 0) continue;
    const rows = db
      .prepare(
        `SELECT messageId
         FROM message_calendar_events
         WHERE accountId = ?
           AND messageId IN (${chunk.map(() => "?").join(",")})
         GROUP BY messageId
         HAVING COUNT(*) > 0
            AND SUM(CASE WHEN processedAtMs IS NULL THEN 1 ELSE 0 END) = 0`
      )
      .all(accountId, ...chunk) as Array<{ messageId?: string | null }>;
    rows.forEach((row) => {
      const messageId = String(row.messageId ?? "").trim();
      if (messageId) {
        processedMessageIds.add(messageId);
      }
    });
  }

  return Array.from(processedMessageIds);
}

export async function deleteMessageCalendarInviteStateByMessageAndEvent(
  accountId: string,
  messageId: string,
  eventUid: string
): Promise<void> {
  const db = await getAccountDb(accountId);
  // Canonical key match — occurrence-scoped rows share the series's
  // `eventUidKey` even when their `eventUid`s differ.
  const normalizedEventUidKey = normalizeCalendarEventUidKey(eventUid);
  if (!normalizedEventUidKey) return;
  db.prepare(
    `DELETE FROM message_calendar_events
     WHERE accountId = ? AND messageId = ? AND lower(COALESCE(eventUidKey, eventUid, '')) = lower(?)`
  ).run(accountId, messageId, normalizedEventUidKey);
}

export type CalendarInviteSnapshotRow = {
  messageId: string;
  eventUid: string;
  inviteActionType: CalendarInviteActionType | null;
  processedAtMs: number | null;
  snapshotJson: string | null;
  snapshotVersion: number | null;
};

type RawSnapshotRow = {
  messageId?: string | null;
  eventUid?: string | null;
  inviteActionType?: string | null;
  processedAtMs?: number | null;
  snapshotJson?: string | null;
  snapshotVersion?: number | null;
};

const SNAPSHOT_SELECT_COLUMNS =
  "messageId, eventUid, inviteActionType, processedAtMs, snapshotJson, snapshotVersion";

function mapSnapshotRow(row?: RawSnapshotRow | null): CalendarInviteSnapshotRow | null {
  if (!row) return null;
  const finiteOrNull = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const trimmedOrNull = (v: string | null | undefined) =>
    typeof v === "string" && v.trim() ? v : null;
  return {
    messageId: String(row.messageId ?? ""),
    eventUid: String(row.eventUid ?? ""),
    inviteActionType: normalizeCalendarInviteActionType(row.inviteActionType),
    processedAtMs: finiteOrNull(row.processedAtMs),
    snapshotJson: trimmedOrNull(row.snapshotJson),
    snapshotVersion: finiteOrNull(row.snapshotVersion)
  };
}

/**
 * Fetch the snapshot JSON stored for a single message/eventUid pair, plus
 * the action type and processedAtMs needed to order siblings.
 */
export async function getMessageCalendarSnapshot(
  accountId: string,
  messageId: string,
  eventUid: string
): Promise<CalendarInviteSnapshotRow | null> {
  const db = await getAccountDb(accountId);
  const normalizedEventUidKey = normalizeCalendarEventUidKey(eventUid);
  if (!normalizedEventUidKey) return null;
  const row = db
    .prepare(
      `SELECT ${SNAPSHOT_SELECT_COLUMNS}
       FROM message_calendar_events
       WHERE accountId = ?
         AND messageId = ?
         AND lower(COALESCE(eventUidKey, eventUid, '')) = lower(?)
       LIMIT 1`
    )
    .get(accountId, messageId, normalizedEventUidKey) as RawSnapshotRow | undefined;
  return mapSnapshotRow(row);
}

/**
 * Find the most recent prior message_calendar_events row for the same
 * eventUid in the same account, strictly before the reference message's
 * received date. Used to derive "what changed" for an update message.
 *
 * Ordered by the delivering message's date, falling back to processedAtMs
 * when two messages share a timestamp. Rows without a snapshot are skipped.
 */
export async function getPriorCalendarSnapshot(
  accountId: string,
  eventUid: string,
  beforeDateValue: number,
  excludeMessageId: string
): Promise<CalendarInviteSnapshotRow | null> {
  const db = await getAccountDb(accountId);
  const normalizedEventUidKey = normalizeCalendarEventUidKey(eventUid);
  if (!normalizedEventUidKey) return null;
  const row = db
    .prepare(
      `SELECT ${SNAPSHOT_SELECT_COLUMNS}
       FROM message_calendar_events mce
       JOIN messages m ON m.accountId = mce.accountId AND m.id = mce.messageId
       WHERE mce.accountId = ?
         AND lower(COALESCE(mce.eventUidKey, mce.eventUid, '')) = lower(?)
         AND mce.messageId <> ?
         AND mce.snapshotJson IS NOT NULL
         AND m.dateValue < ?
       ORDER BY m.dateValue DESC, COALESCE(mce.processedAtMs, 0) DESC, mce.messageId DESC
       LIMIT 1`
    )
    .get(accountId, normalizedEventUidKey, excludeMessageId, beforeDateValue) as
    | RawSnapshotRow
    | undefined;
  return mapSnapshotRow(row);
}

/**
 * List all `eventUid` values attached to a single message (in row order),
 * for callers that want to fan out per-event work without re-reading the
 * full message_calendar_events row.
 */
export async function listMessageCalendarEventUids(
  accountId: string,
  messageId: string
): Promise<string[]> {
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT eventUid
       FROM message_calendar_events
       WHERE accountId = ? AND messageId = ?
       ORDER BY rowid`
    )
    .all(accountId, messageId) as Array<{ eventUid?: string | null }>;
  return rows
    .map((row) => (typeof row.eventUid === "string" ? row.eventUid.trim() : ""))
    .filter((uid): uid is string => Boolean(uid));
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
  // Canonical key match — otherwise an occurrence-scoped row whose
  // `eventUid` differs from the series UID but whose `eventUidKey`
  // matches would be omitted from the source-message list.
  const normalizedEventUidKey = normalizeCalendarEventUidKey(eventUid);
  if (!normalizedEventUidKey) return [];
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
         AND lower(COALESCE(mce.eventUidKey, mce.eventUid, '')) = lower(?)
         AND COALESCE(m.hasSource, 0) = 1
         AND (? = '' OR m.id <> ?)
       ORDER BY m.dateValue ASC, m.id ASC`
    )
    .all(accountId, normalizedEventUidKey, excludedMessageId, excludedMessageId) as Array<{
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
