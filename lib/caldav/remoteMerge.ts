import type { CalendarEvent } from "@/lib/data";
import { parseIcsEvents } from "@/lib/calendar";
import { calendarPreviewToDbEvent } from "./icsSerializer";

/**
 * Merge a remote ICS blob into an existing local event row, keeping the
 * local identity (id, calendarId, source linkage) but adopting the remote
 * content, etag, href, and raw ICS. Clears `pendingRemoteSync` because the
 * row now matches the server. Returns `null` when the ICS has no usable
 * VEVENT (no start), so callers can skip rather than corrupt the row.
 *
 * Shared by the sync reconciler (remote-updated branch) and the conflict
 * resolver's "use server version" path so both apply identical field mapping.
 */
export function mergeRemoteIcsIntoEvent(
  local: CalendarEvent,
  icsData: string,
  opts: { accountId: string; accountEmail: string; remoteEtag?: string; remoteHref?: string }
): CalendarEvent | null {
  let preview;
  try {
    preview = parseIcsEvents(icsData)[0];
  } catch {
    // Malformed ICS — treat it as an unusable remote version rather than
    // throwing (the resolve route maps null to a 422 instead of a 500).
    return null;
  }
  if (!preview?.start) return null;
  const previewEvent = calendarPreviewToDbEvent(preview, opts.accountId, "caldav", {
    calendarId: local.calendarId,
    accountEmail: opts.accountEmail,
    remoteEtag: opts.remoteEtag,
    remoteHref: opts.remoteHref,
    rawIcs: icsData
  });
  return {
    ...local,
    summary: preview.summary?.trim() || local.summary,
    description: preview.description?.trim() || undefined,
    location: preview.location?.trim() || undefined,
    startAtMs: preview.start.getTime(),
    endAtMs: preview.end?.getTime(),
    allDay: preview.allDay,
    startTimezone: preview.startTimezone,
    endTimezone: preview.endTimezone,
    recurrenceRule: preview.recurrenceRule,
    recurrenceDates: preview.recurrenceDates?.map((d) => d.getTime()),
    excludedDates: preview.excludedDates?.map((d) => d.getTime()),
    status: preview.status,
    organizer: preview.organizer,
    attendees: previewEvent.attendees,
    myPartstat: previewEvent.myPartstat,
    myPartstatUpdatedAtMs: previewEvent.myPartstatUpdatedAtMs,
    myAttendeeEmail: previewEvent.myAttendeeEmail,
    replyRequested: previewEvent.replyRequested,
    remoteEtag: opts.remoteEtag,
    remoteHref: opts.remoteHref,
    rawIcs: icsData,
    pendingRemoteSync: undefined,
    updatedAtMs: Date.now()
  };
}
