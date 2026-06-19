/**
 * Writers/readers for the `calendar_event_suppressions` table — the record of
 * calendar series the user has explicitly removed, keyed by `eventUidKey`.
 *
 * Noctua builds its calendar purely from emailed invitations. Google's
 * "synced invitation" transport keeps re-broadcasting a series, so when a user
 * deletes an email-sourced event a later sync would otherwise re-create it. A
 * suppression record lets auto-processing skip re-creation for the whole
 * logical series (re-anchored segments share the same `eventUidKey`); a manual
 * re-import lifts the suppression. See the guard in `calendarInviteProcessor`.
 */
import { getAccountDb } from "../connection";
import { withDbWriteRetry } from "../../dbWriteRetry";
import { normalizeCalendarEventUidKey } from "../../calendarEventUids";

export async function addCalendarEventSuppression(accountId: string, eventUid: string) {
  return withDbWriteRetry("addCalendarEventSuppression", async () => {
    const eventUidKey = normalizeCalendarEventUidKey(eventUid);
    if (!eventUidKey) return false;
    const db = await getAccountDb(accountId);
    db.prepare(
      `INSERT INTO calendar_event_suppressions (accountId, eventUidKey, createdAtMs)
       VALUES (?, ?, ?)
       ON CONFLICT(accountId, eventUidKey) DO NOTHING`
    ).run(accountId, eventUidKey, Date.now());
    return true;
  });
}

export async function removeCalendarEventSuppression(accountId: string, eventUid: string) {
  return withDbWriteRetry("removeCalendarEventSuppression", async () => {
    const eventUidKey = normalizeCalendarEventUidKey(eventUid);
    if (!eventUidKey) return 0;
    const db = await getAccountDb(accountId);
    const result = db
      .prepare(`DELETE FROM calendar_event_suppressions WHERE accountId = ? AND eventUidKey = ?`)
      .run(accountId, eventUidKey) as { changes?: number };
    return result?.changes ?? 0;
  });
}

export async function isCalendarEventSuppressed(
  accountId: string,
  eventUid: string
): Promise<boolean> {
  const eventUidKey = normalizeCalendarEventUidKey(eventUid);
  if (!eventUidKey) return false;
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(
      `SELECT 1 FROM calendar_event_suppressions WHERE accountId = ? AND eventUidKey = ? LIMIT 1`
    )
    .get(accountId, eventUidKey);
  return Boolean(row);
}
