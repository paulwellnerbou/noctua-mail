/**
 * Internal helpers shared between the messages query and retrieval modules and
 * calendar-reminder code that still lives in `lib/db.ts`. This module is NOT
 * part of the public `@/lib/db` surface; import paths stay within `lib/db/`.
 *
 * Scope:
 *   - Generic row-parse helpers (JSON columns, RFC 5322 `References`).
 *   - Attachment hydration (runs for every message returned by the domain).
 *   - Calendar-invite state + UID helpers used by read queries and the
 *     invite-state writers in `lib/db.ts`.
 *   - Small reminder value normalizers reused by the invite-deck group keys
 *     and the reminder persistence layer.
 */
import type { Attachment, MessageCalendarInviteState } from "../../data";
import { buildAccountAttachmentPath } from "../../accountApiPaths";
import { normalizeReminderDateList } from "../../reminderRecurrence";
import { resolveCalendarTimeZoneId } from "../../calendarTimezones";
import {
  normalizeCalendarEventUid,
  normalizeCalendarEventUidKey
} from "../../calendarEventUids";
import type { CalendarInviteActionType } from "../../calendarInviteProcessing";

/** Safe JSON.parse that returns fallback (default undefined) on malformed data instead of throwing. */
export function safeParseJson<T = unknown>(
  value: string | null | undefined,
  fallback?: T
): T | undefined {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function parseReferences(value?: string | null) {
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

export function parseStringArray(value?: string | null) {
  if (!value) return undefined;
  const parsed = safeParseJson<unknown[]>(value);
  if (Array.isArray(parsed)) {
    return parsed.map(String).filter(Boolean);
  }
  return undefined;
}

export function hydrateAttachment(
  accountId: string,
  messageId: string,
  row: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    inline: number | boolean;
    cid?: string | null;
  }
): Attachment {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    inline: Boolean(row.inline),
    cid: row.cid ?? undefined,
    url: buildAccountAttachmentPath(accountId, messageId, row.id)
  };
}

/**
 * SQL fragment that canonicalizes a message_calendar_events row's event UID
 * for case-insensitive comparisons. Used wherever the read surface needs to
 * join invite metadata by event UID.
 */
export function buildCalendarEventUidMatchSql(calendarEventAlias = "mce") {
  return `lower(COALESCE(${calendarEventAlias}.eventUidKey, ${calendarEventAlias}.eventUid, ''))`;
}

export function normalizeCalendarInviteActionType(
  value?: string | null
): CalendarInviteActionType | null {
  if (value === "invitation" || value === "update" || value === "cancellation") {
    return value;
  }
  return null;
}

export function mapMessageCalendarInviteStateRow(row: {
  eventUid?: string | null;
  inviteActionType?: string | null;
  processedAtMs?: number | null;
  processedByUserId?: string | null;
  processedAutomatically?: number | boolean | null;
}): MessageCalendarInviteState | null {
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
        : undefined,
    processedAutomatically:
      typeof row.processedAutomatically === "boolean"
        ? row.processedAutomatically
        : typeof row.processedAutomatically === "number"
          ? row.processedAutomatically !== 0
          : undefined
  };
}

export async function getMessageCalendarInviteDataByMessageId(
  db: any,
  accountId: string,
  messageIds: string[]
) {
  const uniqueMessageIds = Array.from(
    new Set(messageIds.map((value) => value.trim()).filter(Boolean))
  );
  const dataByMessageId = new Map<
    string,
    { calendarEventUids: string[]; calendarInviteStates: MessageCalendarInviteState[] }
  >();
  if (uniqueMessageIds.length === 0) {
    return dataByMessageId;
  }
  const QUERY_BATCH_SIZE = 400;
  for (let start = 0; start < uniqueMessageIds.length; start += QUERY_BATCH_SIZE) {
    const chunk = uniqueMessageIds.slice(start, start + QUERY_BATCH_SIZE);
    const rows = db
      .prepare(
        `SELECT
           messageId,
           eventUid,
           inviteActionType,
           processedAtMs,
           processedByUserId,
           processedAutomatically
         FROM message_calendar_events
         WHERE accountId = ?
           AND messageId IN (${chunk.map(() => "?").join(",")})
         ORDER BY messageId ASC, eventUid ASC`
      )
      .all(accountId, ...chunk) as Array<{
      messageId?: string | null;
      eventUid?: string | null;
      inviteActionType?: string | null;
      processedAtMs?: number | null;
      processedByUserId?: string | null;
      processedAutomatically?: number | boolean | null;
    }>;
    rows.forEach((row) => {
      const messageId = String(row.messageId ?? "").trim();
      if (!messageId) return;
      const existing = dataByMessageId.get(messageId) ?? {
        calendarEventUids: [],
        calendarInviteStates: []
      };
      const eventUid = normalizeCalendarEventUid(row.eventUid);
      if (eventUid && !existing.calendarEventUids.includes(eventUid)) {
        existing.calendarEventUids.push(eventUid);
      }
      const state = mapMessageCalendarInviteStateRow(row);
      if (state) {
        existing.calendarInviteStates.push(state);
      }
      dataByMessageId.set(messageId, existing);
    });
  }
  return dataByMessageId;
}

export function itemsFromUniqueInviteStates(
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

export function normalizeReminderTimezone(value?: string) {
  const normalized = value?.trim();
  if (!normalized) return null;
  return resolveCalendarTimeZoneId(normalized) ?? normalized.replace(/^"|"$/g, "");
}

export function normalizeReminderRecurrenceRule(value?: string) {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (normalized.toUpperCase().startsWith("RRULE:")) {
    const trimmed = normalized.slice(6).trim();
    return trimmed || null;
  }
  return normalized;
}

export function parseReminderDateListJson(value: unknown): number[] | undefined {
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

export function normalizeReminderEventUidKey(uid?: string | null) {
  return normalizeCalendarEventUidKey(uid);
}
