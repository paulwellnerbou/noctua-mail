/**
 * CRUD for `calendar_reminders` — the per-user reminder timers scheduled off
 * individual events. Reminder rows may reference a source message and/or an
 * event UID; `listDeleteCalendarAssociations` additionally walks
 * `calendar_events` to find events linked to the same message/UID so the UI
 * can present a unified delete confirmation for both association kinds.
 */
import type { CalendarReminder } from "../../data";
import { getAccountDb } from "../connection";
import { withDbWriteRetry } from "../../dbWriteRetry";
import { randomUUID } from "crypto";
import {
  hasFutureEventOccurrence,
  normalizeReminderDateList,
  resolveNextReminderOccurrence
} from "../../reminderRecurrence";
import {
  normalizeReminderEventUidKey,
  normalizeReminderRecurrenceRule,
  normalizeReminderTimezone,
  parseReminderDateListJson
} from "../messages/_shared";

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
  // Batch each IN predicate independently so a caller passing more ids
  // than SQLite's default 999-parameter limit can't blow up the query.
  const QUERY_BATCH_SIZE = 400;

  type ReminderRow = {
    id?: string | null;
    messageId?: string | null;
    eventUid?: string | null;
  };
  const reminderRowsById = new Map<string, ReminderRow>();
  const loadReminderRows = (clause: string, values: string[]) => {
    for (let start = 0; start < values.length; start += QUERY_BATCH_SIZE) {
      const chunk = values.slice(start, start + QUERY_BATCH_SIZE);
      const placeholders = chunk.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `SELECT id, messageId, eventUid
           FROM calendar_reminders
           WHERE accountId = ? AND userId = ? AND deletedAtMs IS NULL
             AND ${clause.replace("@PLACEHOLDERS@", placeholders)}`
        )
        .all(accountId, userId, ...chunk) as ReminderRow[];
      rows.forEach((row) => {
        const id = row.id?.trim();
        if (id) reminderRowsById.set(id, row);
      });
    }
  };
  if (uniqueMessageIds.length > 0) {
    loadReminderRows("messageId IN (@PLACEHOLDERS@)", uniqueMessageIds);
  }
  if (uniqueEventUidKeys.length > 0) {
    loadReminderRows(
      "lower(COALESCE(eventUidKey, eventUid, '')) IN (@PLACEHOLDERS@)",
      uniqueEventUidKeys
    );
  }
  const reminderRows = Array.from(reminderRowsById.values());

  type EventRow = {
    id?: string | null;
    eventUid?: string | null;
    startAtMs?: number | null;
    endAtMs?: number | null;
    recurrenceRule?: string | null;
    recurrenceDates?: string | null;
    excludedDates?: string | null;
    startTimezone?: string | null;
  };
  const eventRowsById = new Map<string, EventRow>();
  const eventSelectColumns =
    "ce.id, ce.eventUid, ce.startAtMs, ce.endAtMs, ce.recurrenceRule, ce.recurrenceDates, ce.excludedDates, ce.startTimezone";
  for (let start = 0; start < uniqueMessageIds.length; start += QUERY_BATCH_SIZE) {
    const chunk = uniqueMessageIds.slice(start, start + QUERY_BATCH_SIZE);
    const rows = db
      .prepare(
        `SELECT DISTINCT ${eventSelectColumns}
         FROM calendar_events ce
         WHERE ce.accountId = ? AND ce.deletedAtMs IS NULL
           AND EXISTS (
             SELECT 1
             FROM message_calendar_events mce
             WHERE mce.accountId = ce.accountId
               AND mce.messageId IN (${chunk.map(() => "?").join(", ")})
               AND lower(COALESCE(mce.eventUidKey, mce.eventUid, '')) = lower(COALESCE(ce.eventUid, ''))
           )`
      )
      .all(accountId, ...chunk) as EventRow[];
    rows.forEach((row) => {
      const id = row.id?.trim();
      if (id) eventRowsById.set(id, row);
    });
  }
  for (let start = 0; start < uniqueEventUidKeys.length; start += QUERY_BATCH_SIZE) {
    const chunk = uniqueEventUidKeys.slice(start, start + QUERY_BATCH_SIZE);
    const rows = db
      .prepare(
        `SELECT DISTINCT ${eventSelectColumns}
         FROM calendar_events ce
         WHERE ce.accountId = ? AND ce.deletedAtMs IS NULL
           AND lower(COALESCE(ce.eventUid, '')) IN (${chunk.map(() => "?").join(", ")})`
      )
      .all(accountId, ...chunk) as EventRow[];
    rows.forEach((row) => {
      const id = row.id?.trim();
      if (id) eventRowsById.set(id, row);
    });
  }
  const eventRows = Array.from(eventRowsById.values());
  const nowMs = Date.now();

  return {
    reminders: reminderRows
      .map((row) => ({
        id: row.id?.trim() ?? "",
        messageId: row.messageId?.trim() || undefined,
        eventUid: row.eventUid?.trim() || undefined
      }))
      .filter((row) => Boolean(row.id)),
    events: eventRows
      .map((row) => {
        const startAtMs = Number(row.startAtMs ?? 0);
        const endAtMsRaw = Number(row.endAtMs ?? 0);
        const endAtMs =
          Number.isFinite(endAtMsRaw) && endAtMsRaw > 0 ? endAtMsRaw : undefined;
        const isFuture = hasFutureEventOccurrence(
          {
            eventStartAtMs: startAtMs,
            eventEndAtMs: endAtMs,
            recurrenceRule: row.recurrenceRule ?? undefined,
            recurrenceDates: parseReminderDateListJson(row.recurrenceDates),
            excludedDates: parseReminderDateListJson(row.excludedDates),
            startTimezone: row.startTimezone ?? undefined
          },
          nowMs
        );
        return {
          id: row.id?.trim() ?? "",
          eventUid: row.eventUid?.trim() || undefined,
          isFuture
        };
      })
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
