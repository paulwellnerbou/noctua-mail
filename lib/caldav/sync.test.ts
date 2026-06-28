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
const deleteRemoteEvent = mock(async () => {});

import { syncCalendarEvents, type CaldavSyncDeps } from "./sync";

const syncDeps: Partial<CaldavSyncDeps> = {
  createCaldavClient: (async () => ({})) as unknown as CaldavSyncDeps["createCaldavClient"],
  fetchRemoteCalendars: (async () => [{ url: CALENDAR_URL }]) as unknown as CaldavSyncDeps["fetchRemoteCalendars"],
  fetchRemoteEvents: (async () => remoteObjects) as unknown as CaldavSyncDeps["fetchRemoteEvents"],
  updateRemoteEvent: updateRemoteEvent as unknown as CaldavSyncDeps["updateRemoteEvent"],
  deleteRemoteEvent: deleteRemoteEvent as unknown as CaldavSyncDeps["deleteRemoteEvent"]
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
    deleteRemoteEvent.mockClear();
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

  test("records a conflict instead of blind-pushing when the local etag is missing", async () => {
    const accountId = `acc-sync-noetag-${randomUUID()}`;
    await upsertAccount(buildAccount(accountId));
    const uid = `evt-${randomUUID()}@example.test`;
    const event = buildDirtyEvent(accountId, uid, "etag-1");
    event.remoteEtag = undefined; // legacy/partial row — no etag to compare
    await upsertCalendarEvent(accountId, event);
    remoteObjects = [{ url: event.remoteHref!, etag: "etag-server", data: ics(uid) }];

    const result = await syncCalendarEvents(accountId, syncDeps);

    expect(updateRemoteEvent).not.toHaveBeenCalled();
    expect(result.conflicts).toBe(1);
    const conflicts = await listUnresolvedCalendarEventConflicts(accountId);
    expect(conflicts[0]?.remoteEtag).toBe("etag-server");
  });

  test("skips the push (no blind PUT) when no remote object exists at the href", async () => {
    const accountId = `acc-sync-nohref-${randomUUID()}`;
    await upsertAccount(buildAccount(accountId));
    const uid = `evt-${randomUUID()}@example.test`;
    const event = buildDirtyEvent(accountId, uid, "etag-1");
    await upsertCalendarEvent(accountId, event);
    // UID present (so reconciliation won't soft-delete it) but under a
    // different href than the local event's remoteHref.
    remoteObjects = [{ url: `${CALENDAR_URL}moved-${uid}.ics`, etag: "x", data: ics(uid) }];

    const result = await syncCalendarEvents(accountId, syncDeps);

    expect(updateRemoteEvent).not.toHaveBeenCalled();
    expect(result.conflicts).toBe(0);
    const stored = await getCalendarEventById(accountId, event.id);
    expect(stored?.pendingRemoteSync).toBe(event.pendingRemoteSync); // still dirty
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

  test("pushes a remote DELETE for a soft-deleted event and drops its linkage", async () => {
    const accountId = `acc-sync-delete-${randomUUID()}`;
    await upsertAccount(buildAccount(accountId));
    const uid = `evt-${randomUUID()}@example.test`;
    const event = buildDirtyEvent(accountId, uid, "etag-1");
    event.deletedAtMs = Date.UTC(2026, 0, 11, 0, 0, 0);
    await upsertCalendarEvent(accountId, event);
    // Still present on the server → the user removed it locally.
    remoteObjects = [{ url: event.remoteHref!, etag: "etag-1", data: ics(uid) }];

    await syncCalendarEvents(accountId, syncDeps);

    expect(deleteRemoteEvent).toHaveBeenCalledTimes(1);
    const stored = await getCalendarEventById(accountId, event.id);
    expect(stored?.remoteHref).toBeUndefined();
    expect(stored?.remoteEtag).toBeUndefined();
    expect(stored?.pendingRemoteSync).toBeUndefined();
    expect(stored?.deletedAtMs).toBe(event.deletedAtMs);
  });

  test("does not DELETE without an If-Match etag from the server listing", async () => {
    const accountId = `acc-sync-delete-noetag-${randomUUID()}`;
    await upsertAccount(buildAccount(accountId));
    const uid = `evt-${randomUUID()}@example.test`;
    const event = buildDirtyEvent(accountId, uid, "etag-1");
    event.deletedAtMs = Date.UTC(2026, 0, 11, 0, 0, 0);
    await upsertCalendarEvent(accountId, event);
    // Present on the server but the listing carries no etag → can't guard.
    remoteObjects = [{ url: event.remoteHref!, etag: "", data: ics(uid) }];

    await syncCalendarEvents(accountId, syncDeps);

    expect(deleteRemoteEvent).not.toHaveBeenCalled();
    const stored = await getCalendarEventById(accountId, event.id);
    expect(stored?.remoteHref).toBe(event.remoteHref); // linkage left intact for retry
  });

  test("does not push a DELETE for an event already gone from the server", async () => {
    const accountId = `acc-sync-delete-gone-${randomUUID()}`;
    await upsertAccount(buildAccount(accountId));
    const uid = `evt-${randomUUID()}@example.test`;
    const event = buildDirtyEvent(accountId, uid, "etag-1");
    event.pendingRemoteSync = undefined;
    event.deletedAtMs = Date.UTC(2026, 0, 11, 0, 0, 0);
    await upsertCalendarEvent(accountId, event);
    remoteObjects = []; // not on the server anymore

    await syncCalendarEvents(accountId, syncDeps);

    expect(deleteRemoteEvent).not.toHaveBeenCalled();
  });
});
