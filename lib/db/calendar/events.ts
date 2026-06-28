/**
 * CRUD for `calendar_events` plus the participation-override writers
 * (`calendar_participation_overrides`) that are tightly coupled to event
 * lookups. Participation resolution lives here because
 * `resolveCalendarParticipation` reads the underlying event row via
 * `getCalendarEventById` before consulting the override table; splitting
 * that read off would force a cross-module round-trip for a single lookup.
 */
import type {
  CalendarEvent,
  CalendarEventEmailSnapshotFields,
  CalendarEventSourceType,
  CalendarParticipationScope,
  CalendarParticipationStatus
} from "../../data";
import { getAccountDb } from "../connection";
import { normalizeCalendarEventUid, normalizeCalendarEventUidKey } from "../../calendarEventUids";
import { normalizeCalendarParticipationStatus } from "../../calendarParticipation";
import { safeParseJson } from "../messages/_shared";

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
    recurrenceDates: safeParseJson<number[]>(row.recurrenceDates),
    excludedDates: safeParseJson<number[]>(row.excludedDates),
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
    pendingRemoteSync: row.pendingRemoteSync ?? undefined,
    sourceType: (row.sourceType as CalendarEventSourceType) ?? "local",
    messageId: row.messageId ?? undefined,
    occurrenceMessageIds: safeParseJson<Record<string, string>>(row.occurrenceMessageIds),
    sourceSubject: row.sourceSubject ?? undefined,
    sourceFromAddr: row.sourceFromAddr ?? undefined,
    sourceToAddr: row.sourceToAddr ?? undefined,
    sourceCcAddr: row.sourceCcAddr ?? undefined,
    sourceBccAddr: row.sourceBccAddr ?? undefined,
    sourceDateMs: typeof row.sourceDateMs === "number" ? row.sourceDateMs : undefined,
    sourceBodyText: row.sourceBodyText ?? undefined,
    sourceBodyHtml: row.sourceBodyHtml ?? undefined,
    occurrenceSnapshots: safeParseJson<Record<string, CalendarEventEmailSnapshotFields>>(
      row.occurrenceSnapshots
    ),
    occurrenceRecurrenceIds: safeParseJson<Record<string, number>>(row.occurrenceRecurrenceIds),
    eventUidKey: row.eventUidKey ?? undefined,
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
  // Normalize inputs symmetrically with `rowToCalendarParticipationOverride`
  // so reads and writes agree on what counts as a valid row. Without
  // normalization, unparsed partstats / unnormalized UIDs / bad
  // timestamps would slip into the table and then be silently ignored
  // by the read path.
  const normalizedEventUid = normalizeCalendarEventUid(input.eventUid);
  if (!normalizedEventUid) {
    throw new Error("upsertCalendarParticipationOverride: eventUid is required");
  }
  const normalizedPartstat = normalizeCalendarParticipationStatus(input.partstat);
  if (!normalizedPartstat) {
    throw new Error(
      `upsertCalendarParticipationOverride: invalid partstat ${JSON.stringify(input.partstat)}`
    );
  }
  const normalizedOccurrenceStartAtMs =
    typeof input.occurrenceStartAtMs === "number" &&
    Number.isFinite(input.occurrenceStartAtMs) &&
    input.occurrenceStartAtMs > 0
      ? Math.round(input.occurrenceStartAtMs)
      : null;
  if (normalizedOccurrenceStartAtMs === null) {
    throw new Error(
      `upsertCalendarParticipationOverride: invalid occurrenceStartAtMs ${JSON.stringify(input.occurrenceStartAtMs)}`
    );
  }
  const normalizedAttendeeEmail =
    typeof input.attendeeEmail === "string" && input.attendeeEmail.trim()
      ? input.attendeeEmail.trim()
      : undefined;
  // Inline the existence check instead of delegating to the async
  // helper — `getCalendarParticipationOverrideForOccurrence` would
  // call `getAccountDb` again for a handle we already hold.
  const existingRow = db
    .prepare(
      `SELECT * FROM calendar_participation_overrides
       WHERE accountId = ? AND eventUid = ? AND occurrenceStartAtMs = ?`
    )
    .get(accountId, normalizedEventUid, normalizedOccurrenceStartAtMs) as any;
  const existing = existingRow ? rowToCalendarParticipationOverride(existingRow) : null;
  const row: CalendarParticipationOverrideRow = {
    id: existing?.id ?? `calp-${crypto.randomUUID()}`,
    accountId,
    eventUid: normalizedEventUid,
    occurrenceStartAtMs: normalizedOccurrenceStartAtMs,
    partstat: normalizedPartstat,
    attendeeEmail: normalizedAttendeeEmail,
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
  const normalizedEventUid = String(eventUid ?? "").trim();
  if (!normalizedEventUid) return null;
  const exactRow = db
    .prepare(
      `SELECT * FROM calendar_events WHERE accountId = ? AND eventUid = ? AND deletedAtMs IS NULL`
    )
    .get(accountId, normalizedEventUid) as any;
  if (exactRow) return rowToCalendarEvent(exactRow);
  const foldedRow = db
    .prepare(
      `SELECT * FROM calendar_events
       WHERE accountId = ?
         AND lower(eventUid) = lower(?)
         AND deletedAtMs IS NULL
       ORDER BY CASE WHEN eventUid = ? THEN 0 ELSE 1 END, updatedAtMs DESC
       LIMIT 1`
    )
    .get(accountId, normalizedEventUid, normalizedEventUid) as any;
  return foldedRow ? rowToCalendarEvent(foldedRow) : null;
}

/**
 * Returns other live calendar_events rows that share the same logical
 * series as `eventUid` (per `normalizeCalendarEventUidKey`) but have a
 * different exact UID. Used by the invite processor to find prior
 * Google `_R<datetime>` anchors that need to be UNTIL-capped when a
 * newer anchor arrives. Returns an empty array when the key is null
 * or when only the exact-UID row exists.
 */
export async function listSiblingCalendarEventsByUidKey(
  accountId: string,
  eventUid: string
): Promise<CalendarEvent[]> {
  const eventUidKey = normalizeCalendarEventUidKey(eventUid);
  if (!eventUidKey) return [];
  const exactUid = String(eventUid ?? "").trim();
  if (!exactUid) return [];
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT * FROM calendar_events
       WHERE accountId = ?
         AND eventUidKey = ?
         AND deletedAtMs IS NULL
         AND lower(eventUid) <> lower(?)
       ORDER BY startAtMs ASC`
    )
    .all(accountId, eventUidKey, exactUid) as any[];
  return rows.map(rowToCalendarEvent);
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
  const existing = await getCalendarEventByUid(accountId, eventUid);
  if (!existing) return;
  await deleteCalendarEvent(accountId, existing.id);
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
      remoteEtag, remoteHref, rawIcs, pendingRemoteSync, sourceType, messageId, occurrenceMessageIds,
      sourceSubject, sourceFromAddr, sourceToAddr, sourceCcAddr, sourceBccAddr,
      sourceDateMs, sourceBodyText, sourceBodyHtml, occurrenceSnapshots, occurrenceRecurrenceIds,
      eventUidKey,
      createdAtMs, updatedAtMs, deletedAtMs
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    event.pendingRemoteSync ?? null,
    event.sourceType,
    event.messageId ?? null,
    event.occurrenceMessageIds && Object.keys(event.occurrenceMessageIds).length > 0
      ? JSON.stringify(event.occurrenceMessageIds)
      : null,
    event.sourceSubject ?? null,
    event.sourceFromAddr ?? null,
    event.sourceToAddr ?? null,
    event.sourceCcAddr ?? null,
    event.sourceBccAddr ?? null,
    typeof event.sourceDateMs === "number" ? event.sourceDateMs : null,
    event.sourceBodyText ?? null,
    event.sourceBodyHtml ?? null,
    event.occurrenceSnapshots && Object.keys(event.occurrenceSnapshots).length > 0
      ? JSON.stringify(event.occurrenceSnapshots)
      : null,
    event.occurrenceRecurrenceIds && Object.keys(event.occurrenceRecurrenceIds).length > 0
      ? JSON.stringify(event.occurrenceRecurrenceIds)
      : null,
    event.eventUidKey ?? normalizeCalendarEventUidKey(event.eventUid) ?? null,
    event.createdAtMs,
    event.updatedAtMs,
    event.deletedAtMs ?? null
  );
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

/**
 * Soft-deleted CalDAV events that still carry a `remoteHref` — i.e. local
 * deletions whose removal hasn't been pushed to the server yet. Deliberately
 * *not* filtered by `deletedAtMs IS NULL` (unlike `listCalendarEventsBySource`)
 * because these are exactly the deleted rows the sync delete-push needs.
 */
export async function listSoftDeletedCaldavEventsToPush(
  accountId: string
): Promise<CalendarEvent[]> {
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT * FROM calendar_events
       WHERE accountId = ? AND sourceType = 'caldav'
         AND deletedAtMs IS NOT NULL AND remoteHref IS NOT NULL`
    )
    .all(accountId) as any[];
  return rows.map(rowToCalendarEvent);
}
