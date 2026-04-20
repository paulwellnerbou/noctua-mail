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
import { ensureMessageCalendarEventOptionalColumns } from "../schema";
import { withDbWriteRetry } from "../../dbWriteRetry";
import { type CalendarInviteActionType } from "../../calendarInviteProcessing";
import {
  normalizeCalendarEventUid,
  normalizeCalendarEventUidKey,
  normalizeCalendarEventUids
} from "../../calendarEventUids";
import {
  itemsFromUniqueInviteStates,
  normalizeCalendarInviteActionType
} from "../messages/_shared";

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
  options?: {
    processedAtMs?: number | null;
    processedByUserId?: string | null;
    processedAutomatically?: boolean | null;
  }
) {
  return withDbWriteRetry("markMessageCalendarInviteStatesProcessed", async () => {
    const db = await getAccountDb(accountId);
    ensureMessageCalendarEventOptionalColumns(db);
    const normalizedEventUids = normalizeCalendarEventUids(eventUids);
    if (normalizedEventUids.length === 0) return 0;
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
    const result = db
      .prepare(
        `UPDATE message_calendar_events
         SET processedAtMs = ?, processedByUserId = ?, processedAutomatically = ?
         WHERE accountId = ?
           AND messageId = ?
           AND eventUid IN (${normalizedEventUids.map(() => "?").join(",")})`
      )
      .run(
        processedAtMs,
        processedByUserId,
        processedAutomatically,
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
         SET processedAtMs = NULL, processedByUserId = NULL, processedAutomatically = NULL
         WHERE accountId = ? AND lower(eventUid) = lower(?)`
      )
      .run(accountId, normalizedEventUid) as { changes?: number };
    return result?.changes ?? 0;
  });
}

export async function listFullyProcessedCalendarInviteMessageIds(
  accountId: string,
  messageIds: string[]
): Promise<string[]> {
  const db = await getAccountDb(accountId);
  ensureMessageCalendarEventOptionalColumns(db);
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
