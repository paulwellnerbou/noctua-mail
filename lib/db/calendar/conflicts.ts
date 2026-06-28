/**
 * Writers/readers for `calendar_event_conflicts` — the record of CalDAV
 * write-back conflicts awaiting user resolution. A row exists only while an
 * event diverged on both sides (local edit + remote change) since the last
 * sync. It stores the three full ICS snapshots (base/local/remote) so the
 * resolution UI can render a field-level diff and apply either side without
 * re-fetching from the server. Resolving an event deletes its row.
 */
import { getAccountDb } from "../connection";
import { withDbWriteRetry } from "../../dbWriteRetry";

export type CalendarEventConflict = {
  eventId: string;
  accountId: string;
  eventUid: string;
  summary?: string;
  timeZone?: string;
  allDay: boolean;
  baseIcs?: string;
  localIcs: string;
  remoteIcs: string;
  remoteEtag?: string;
  localChangedAtMs?: number;
  remoteChangedAtMs?: number;
  detectedAtMs: number;
};

function rowToConflict(row: any): CalendarEventConflict {
  return {
    eventId: row.eventId,
    accountId: row.accountId,
    eventUid: row.eventUid,
    summary: row.summary ?? undefined,
    timeZone: row.timeZone ?? undefined,
    allDay: Boolean(row.allDay),
    baseIcs: row.baseIcs ?? undefined,
    localIcs: row.localIcs,
    remoteIcs: row.remoteIcs,
    remoteEtag: row.remoteEtag ?? undefined,
    localChangedAtMs: row.localChangedAtMs ?? undefined,
    remoteChangedAtMs: row.remoteChangedAtMs ?? undefined,
    detectedAtMs: row.detectedAtMs
  };
}

export async function upsertCalendarEventConflict(
  accountId: string,
  conflict: CalendarEventConflict
): Promise<void> {
  await withDbWriteRetry("upsertCalendarEventConflict", async () => {
    const db = await getAccountDb(accountId);
    db.prepare(
      `INSERT OR REPLACE INTO calendar_event_conflicts (
        eventId, accountId, eventUid, summary, timeZone, allDay,
        baseIcs, localIcs, remoteIcs, remoteEtag,
        localChangedAtMs, remoteChangedAtMs, detectedAtMs
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      conflict.eventId,
      conflict.accountId,
      conflict.eventUid,
      conflict.summary ?? null,
      conflict.timeZone ?? null,
      conflict.allDay ? 1 : 0,
      conflict.baseIcs ?? null,
      conflict.localIcs,
      conflict.remoteIcs,
      conflict.remoteEtag ?? null,
      conflict.localChangedAtMs ?? null,
      conflict.remoteChangedAtMs ?? null,
      conflict.detectedAtMs
    );
  });
}

export async function listUnresolvedCalendarEventConflicts(
  accountId: string
): Promise<CalendarEventConflict[]> {
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT * FROM calendar_event_conflicts WHERE accountId = ? ORDER BY detectedAtMs ASC`
    )
    .all(accountId) as any[];
  return rows.map(rowToConflict);
}

export async function getCalendarEventConflict(
  accountId: string,
  eventId: string
): Promise<CalendarEventConflict | null> {
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(`SELECT * FROM calendar_event_conflicts WHERE accountId = ? AND eventId = ?`)
    .get(accountId, eventId) as any;
  return row ? rowToConflict(row) : null;
}

export async function deleteCalendarEventConflict(
  accountId: string,
  eventId: string
): Promise<void> {
  await withDbWriteRetry("deleteCalendarEventConflict", async () => {
    const db = await getAccountDb(accountId);
    db.prepare(`DELETE FROM calendar_event_conflicts WHERE accountId = ? AND eventId = ?`).run(
      accountId,
      eventId
    );
  });
}
