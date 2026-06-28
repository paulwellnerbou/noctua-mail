import {
  getAccountById,
  listCalendarEventsBySource,
  listSoftDeletedCaldavEventsToPush,
  upsertCalendarEvent,
  softDeleteCalendarEvent,
  upsertCalendarEventConflict,
  deleteCalendarEventConflict
} from "@/lib/db";
import { parseIcsEvents } from "@/lib/calendar";
import {
  calendarPreviewToDbEvent,
  calendarEventToIcs,
  patchIcsForEvent,
  parseIcsLastModified
} from "./icsSerializer";
import { mergeRemoteIcsIntoEvent } from "./remoteMerge";
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
  updatedRemote: number;
  deleted: number;
  conflicts: number;
  errors: string[];
};

// The CalDAV network surface, injectable so tests can stub it without
// `mock.module`-ing `./client` — that module is also covered by client.test.ts
// (its real SSRF guard), and a global module mock would strip those exports.
export type CaldavSyncDeps = {
  createCaldavClient: typeof createCaldavClient;
  fetchRemoteCalendars: typeof fetchRemoteCalendars;
  fetchRemoteEvents: typeof fetchRemoteEvents;
  pushEventToRemote: typeof pushEventToRemote;
  updateRemoteEvent: typeof updateRemoteEvent;
  deleteRemoteEvent: typeof deleteRemoteEvent;
};

const defaultSyncDeps: CaldavSyncDeps = {
  createCaldavClient,
  fetchRemoteCalendars,
  fetchRemoteEvents,
  pushEventToRemote,
  updateRemoteEvent,
  deleteRemoteEvent
};

export async function syncCalendarEvents(
  accountId: string,
  depsOverride: Partial<CaldavSyncDeps> = {}
): Promise<CalendarSyncResult> {
  const deps = { ...defaultSyncDeps, ...depsOverride };
  const result: CalendarSyncResult = {
    accountId,
    inserted: 0,
    updated: 0,
    pushed: 0,
    updatedRemote: 0,
    deleted: 0,
    conflicts: 0,
    errors: []
  };

  const account = await getAccountById(accountId);
  if (!account?.caldav?.url) {
    return result;
  }

  const config = account.caldav;

  try {
    const client = await deps.createCaldavClient(config);
    const calendars = await deps.fetchRemoteCalendars(client, config.calendarPath);

    for (const calendar of calendars) {
      const calendarId = calendar.url ?? "";
      try {
        // Fetch all remote objects
        const remoteObjects = await deps.fetchRemoteEvents(client, calendar);

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
            if (local.pendingRemoteSync) {
              // Diverged on both sides — leave the local edit intact; the push
              // loop below records a conflict for the user to resolve.
              continue;
            }
            // Remote-updated: etag changed, update local
            try {
              const updated = mergeRemoteIcsIntoEvent(local, remote.icsData, {
                accountId,
                accountEmail: account.email,
                remoteEtag: remote.etag,
                remoteHref: remote.href
              });
              if (updated) {
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
            const pushed = await deps.pushEventToRemote(client, calendar, ev.eventUid, icsData);
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

        // Push local edits to existing remote events (dirty flag set by the
        // mutation routes). Skip and record a conflict when the remote also
        // changed since we last pulled it.
        for (const ev of allCaldavLocal) {
          if (ev.calendarId !== calendarId) continue;
          if (!ev.pendingRemoteSync || !ev.remoteHref || ev.deletedAtMs) continue;
          // Look up by the actual remote object identity (href), not a
          // re-parsed UID, so the If-Match safety check matches what we'd PUT.
          const remote = remoteByHref.get(ev.remoteHref);
          // Only push when we can prove the local copy is based on the server's
          // current revision: a matching, non-empty etag. A diverged etag *or*
          // a missing local etag (legacy/partial rows) means an If-Match push
          // would blind-overwrite the server — record a conflict instead.
          const upToDateWithRemote =
            !!remote && !!ev.remoteEtag && remote.etag === ev.remoteEtag;
          if (remote && !upToDateWithRemote) {
            await upsertCalendarEventConflict(accountId, {
              eventId: ev.id,
              accountId,
              eventUid: ev.eventUid,
              summary: ev.summary,
              timeZone: ev.startTimezone,
              allDay: ev.allDay,
              baseIcs: ev.rawIcs,
              localIcs: patchIcsForEvent(ev.rawIcs, ev),
              remoteIcs: remote.icsData,
              remoteEtag: remote.etag,
              localChangedAtMs: ev.pendingRemoteSync,
              remoteChangedAtMs: parseIcsLastModified(remote.icsData),
              detectedAtMs: Date.now()
            });
            result.conflicts++;
            result.errors.push(
              `Conflict for UID ${ev.eventUid}: local edit cannot be safely pushed (etag mismatch or missing)`
            );
            continue;
          }
          try {
            const icsData = patchIcsForEvent(ev.rawIcs, ev);
            const res = await deps.updateRemoteEvent(client, ev.remoteHref, ev.remoteEtag, icsData);
            await upsertCalendarEvent(accountId, {
              ...ev,
              remoteEtag: res.etag ?? ev.remoteEtag,
              rawIcs: icsData,
              pendingRemoteSync: undefined,
              updatedAtMs: Date.now()
            });
            await deleteCalendarEventConflict(accountId, ev.id);
            result.updatedRemote++;
          } catch (e) {
            result.errors.push(`Update push error for event ${ev.id}: ${e}`);
          }
        }

        // Push soft-deleted local events to remote. Only events still present
        // on the server (remoteByUid) are deleted — a soft-delete on something
        // already gone remotely was created by the reconciliation above and
        // needs no call. On success drop the remote linkage so we don't retry
        // every sync and so an undo (restore) re-creates it as a new object.
        const deletedEvents = await listSoftDeletedCaldavEventsToPush(accountId);
        for (const ev of deletedEvents) {
          if (ev.calendarId !== calendarId || !ev.remoteHref) continue;
          if (!remoteByHref.has(ev.remoteHref)) continue;
          try {
            await deps.deleteRemoteEvent(client, ev.remoteHref, ev.remoteEtag);
            await upsertCalendarEvent(accountId, {
              ...ev,
              remoteHref: undefined,
              remoteEtag: undefined
            });
          } catch {
            // leave the linkage intact so the next sync retries
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
