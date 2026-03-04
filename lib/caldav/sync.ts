import { getAccountById, listCalendarEventsBySource, upsertCalendarEvent, softDeleteCalendarEvent } from "@/lib/db";
import { parseIcsEvents } from "@/lib/calendar";
import { calendarPreviewToDbEvent, calendarEventToIcs } from "./icsSerializer";
import {
  createCaldavClient,
  fetchRemoteCalendars,
  fetchRemoteEvents,
  pushEventToRemote,
  updateRemoteEvent,
  deleteRemoteEvent
} from "./client";
import type { CalendarEvent } from "@/lib/data";

export type CalendarSyncResult = {
  accountId: string;
  inserted: number;
  updated: number;
  pushed: number;
  deleted: number;
  errors: string[];
};

export async function syncCalendarEvents(accountId: string): Promise<CalendarSyncResult> {
  const result: CalendarSyncResult = {
    accountId,
    inserted: 0,
    updated: 0,
    pushed: 0,
    deleted: 0,
    errors: []
  };

  const account = await getAccountById(accountId);
  if (!account?.caldav?.url) {
    return result;
  }

  const config = account.caldav;

  try {
    const client = await createCaldavClient(config);
    const calendars = await fetchRemoteCalendars(client, config.calendarPath);

    for (const calendar of calendars) {
      const calendarId = calendar.url ?? "";
      try {
        // Fetch all remote objects
        const remoteObjects = await fetchRemoteEvents(client, calendar);

        const remoteByHref = new Map<string, { etag: string; icsData: string }>();
        const remoteByUid = new Map<string, { href: string; etag: string; icsData: string }>();

        for (const obj of remoteObjects) {
          const href = obj.url ?? "";
          const etag = (obj.etag as string | undefined) ?? "";
          const icsData = (obj.data as string | undefined) ?? "";
          remoteByHref.set(href, { etag, icsData });

          // Extract UID from ICS
          const uidMatch = icsData.match(/^UID:(.+)$/m);
          const uid = uidMatch?.[1]?.trim() ?? "";
          if (uid) {
            remoteByUid.set(uid, { href, etag, icsData });
          }
        }

        // Get all local CalDAV events for this calendar
        const localEvents = await listCalendarEventsBySource(accountId, "caldav");
        const localByHref = new Map<string, CalendarEvent>();
        const localByUid = new Map<string, CalendarEvent>();
        for (const ev of localEvents) {
          if (ev.calendarId !== calendarId) continue;
          if (ev.remoteHref) localByHref.set(ev.remoteHref, ev);
          localByUid.set(ev.eventUid, ev);
        }

        // Process remote events: insert new, update changed
        for (const [uid, remote] of remoteByUid) {
          const local = localByUid.get(uid);
          if (!local) {
            // Remote-new: parse and insert
            try {
              const previews = parseIcsEvents(remote.icsData);
              for (const preview of previews) {
                if (!preview.start) continue;
                const dbEvent = calendarPreviewToDbEvent(preview, accountId, "caldav", {
                  calendarId,
                  accountEmail: account.email,
                  remoteEtag: remote.etag,
                  remoteHref: remote.href,
                  rawIcs: remote.icsData
                });
                await upsertCalendarEvent(accountId, dbEvent);
                result.inserted++;
              }
            } catch (e) {
              result.errors.push(`Parse error for UID ${uid}: ${e}`);
            }
          } else if (local.remoteEtag !== remote.etag) {
            // Remote-updated: etag changed, update local
            try {
              const previews = parseIcsEvents(remote.icsData);
              const preview = previews[0];
              if (preview?.start) {
                const previewEvent = calendarPreviewToDbEvent(preview, accountId, "caldav", {
                  calendarId,
                  accountEmail: account.email,
                  remoteEtag: remote.etag,
                  remoteHref: remote.href,
                  rawIcs: remote.icsData
                });
                const updated: CalendarEvent = {
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
                  remoteEtag: remote.etag,
                  remoteHref: remote.href,
                  rawIcs: remote.icsData,
                  updatedAtMs: Date.now()
                };
                await upsertCalendarEvent(accountId, updated);
                result.updated++;
              }
            } catch (e) {
              result.errors.push(`Update error for UID ${uid}: ${e}`);
            }
          }
        }

        // Handle remote deletions: local events not in remote anymore
        for (const [uid, local] of localByUid) {
          if (local.calendarId !== calendarId) continue;
          if (!remoteByUid.has(uid) && local.remoteHref) {
            await softDeleteCalendarEvent(accountId, local.id);
            result.deleted++;
          }
        }

        // Push local-new events to remote (no remoteHref)
        const allCaldavLocal = await listCalendarEventsBySource(accountId, "caldav");
        for (const ev of allCaldavLocal) {
          if (ev.calendarId !== calendarId) continue;
          if (ev.remoteHref) continue; // already pushed
          try {
            const icsData = calendarEventToIcs(ev);
            const pushed = await pushEventToRemote(client, calendar, ev.eventUid, icsData);
            const updatedEv: CalendarEvent = {
              ...ev,
              remoteHref: pushed.url,
              remoteEtag: pushed.etag,
              rawIcs: icsData,
              updatedAtMs: Date.now()
            };
            await upsertCalendarEvent(accountId, updatedEv);
            result.pushed++;
          } catch (e) {
            result.errors.push(`Push error for event ${ev.id}: ${e}`);
          }
        }

        // Push soft-deleted local events to remote
        const allEvents = await listCalendarEventsBySource(accountId, "caldav");
        for (const ev of allEvents) {
          if (!ev.deletedAtMs || !ev.remoteHref) continue;
          if (ev.calendarId !== calendarId) continue;
          try {
            await deleteRemoteEvent(client, ev.remoteHref, ev.remoteEtag);
          } catch {
            // ignore — may already be deleted on server
          }
        }
      } catch (e) {
        result.errors.push(`Calendar sync error for ${calendarId}: ${e}`);
      }
    }
  } catch (err) {
    result.errors.push(`CalDAV client error: ${err}`);
  }

  return result;
}
