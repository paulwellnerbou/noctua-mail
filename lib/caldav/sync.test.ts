import { describe, expect, test, mock, beforeEach } from "bun:test";
import { randomUUID } from "crypto";
import type { Account, CalendarEvent } from "@/lib/data";
import { dbModulePromise } from "@/lib/testDbHarness";

const CALENDAR_URL = "https://caldav.example.test/cal/";

// Controllable remote state + spies, passed via dependency injection so we
// never `mock.module` the real ./client (whose SSRF guard client.test.ts
// covers — a global module mock would strip those exports).
let remoteObjects: Array<{ url: string; etag: string; data: string }> = [];
const updateRemoteEvent = mock(async () => ({ etag: "etag-new" }));

import { syncCalendarEvents, type CaldavSyncDeps } from "./sync";

const syncDeps: Partial<CaldavSyncDeps> = {
  createCaldavClient: (async () => ({})) as unknown as CaldavSyncDeps["createCaldavClient"],
  fetchRemoteCalendars: (async () => [{ url: CALENDAR_URL }]) as unknown as CaldavSyncDeps["fetchRemoteCalendars"],
  fetchRemoteEvents: (async () => remoteObjects) as unknown as CaldavSyncDeps["fetchRemoteEvents"],
  updateRemoteEvent: updateRemoteEvent as unknown as CaldavSyncDeps["updateRemoteEvent"]
};

const { upsertAccount, upsertCalendarEvent, getCalendarEventById, listUnresolvedCalendarEventConflicts } =
  await dbModulePromise;

function ics(uid: string): string {
  return ["BEGIN:VCALENDAR", "BEGIN:VEVENT", `UID:${uid}`, "DTSTART:20260110T090000Z", "SUMMARY:Sync", "END:VEVENT", "END:VCALENDAR"].join("\n");
}

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Sync Test",
    email: "owner@example.test",
    avatar: "ST",
    imap: { host: "imap.example.test", port: 993, secure: true, user: "owner@example.test", password: "secret" },
    smtp: { host: "smtp.example.test", port: 465, secure: true, user: "owner@example.test", password: "secret" },
    caldav: { url: "https://caldav.example.test/", user: "owner@example.test", password: "secret" }
  };
}

function buildDirtyEvent(accountId: string, uid: string, remoteEtag: string): CalendarEvent {
  const now = Date.UTC(2026, 0, 10, 9, 0, 0);
  return {
    id: `evt-${randomUUID()}`,
    accountId,
    calendarId: CALENDAR_URL,
    eventUid: uid,
    summary: "Sync",
    startAtMs: now,
    endAtMs: now + 30 * 60 * 1000,
    allDay: false,
    sourceType: "caldav",
    remoteHref: `${CALENDAR_URL}${uid}.ics`,
    remoteEtag,
    rawIcs: ics(uid),
    pendingRemoteSync: now,
    createdAtMs: now,
    updatedAtMs: now
  };
}

describe("syncCalendarEvents write-back", () => {
  beforeEach(() => {
    updateRemoteEvent.mockClear();
    remoteObjects = [];
  });

  test("pushes a locally-edited remote event and clears the dirty flag", async () => {
    const accountId = `acc-sync-push-${randomUUID()}`;
    await upsertAccount(buildAccount(accountId));
    const uid = `evt-${randomUUID()}@example.test`;
    const event = buildDirtyEvent(accountId, uid, "etag-1");
    await upsertCalendarEvent(accountId, event);
    // Same etag on the server → no conflict, push proceeds.
    remoteObjects = [{ url: event.remoteHref!, etag: "etag-1", data: ics(uid) }];

    const result = await syncCalendarEvents(accountId, syncDeps);

    expect(updateRemoteEvent).toHaveBeenCalledTimes(1);
    expect(result.updatedRemote).toBe(1);
    const stored = await getCalendarEventById(accountId, event.id);
    expect(stored?.pendingRemoteSync).toBeUndefined();
    expect(stored?.remoteEtag).toBe("etag-new");
    expect(await listUnresolvedCalendarEventConflicts(accountId)).toHaveLength(0);
  });

  test("records a conflict and pushes nothing when the server also changed", async () => {
    const accountId = `acc-sync-conflict-${randomUUID()}`;
    await upsertAccount(buildAccount(accountId));
    const uid = `evt-${randomUUID()}@example.test`;
    const event = buildDirtyEvent(accountId, uid, "etag-1");
    await upsertCalendarEvent(accountId, event);
    // Server moved on to a different etag → conflict.
    remoteObjects = [{ url: event.remoteHref!, etag: "etag-2", data: ics(uid) }];

    const result = await syncCalendarEvents(accountId, syncDeps);

    expect(updateRemoteEvent).not.toHaveBeenCalled();
    expect(result.conflicts).toBe(1);
    const conflicts = await listUnresolvedCalendarEventConflicts(accountId);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.eventId).toBe(event.id);
    // Local edit preserved, flag still set for the next attempt / resolution.
    const stored = await getCalendarEventById(accountId, event.id);
    expect(stored?.pendingRemoteSync).toBe(event.pendingRemoteSync);
    expect(stored?.remoteEtag).toBe("etag-1");
  });

  test("ignores caldav events that are not dirty", async () => {
    const accountId = `acc-sync-clean-${randomUUID()}`;
    await upsertAccount(buildAccount(accountId));
    const uid = `evt-${randomUUID()}@example.test`;
    const event = buildDirtyEvent(accountId, uid, "etag-1");
    event.pendingRemoteSync = undefined;
    await upsertCalendarEvent(accountId, event);
    remoteObjects = [{ url: event.remoteHref!, etag: "etag-1", data: ics(uid) }];

    await syncCalendarEvents(accountId, syncDeps);

    expect(updateRemoteEvent).not.toHaveBeenCalled();
  });
});
