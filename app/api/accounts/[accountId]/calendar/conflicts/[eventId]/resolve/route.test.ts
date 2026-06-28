import { randomUUID } from "crypto";
import { describe, expect, test, mock, beforeEach } from "bun:test";
import type { Account, CalendarEvent } from "@/lib/data";
import { dbModulePromise } from "@/lib/testDbHarness";
import { applyConflictResolution, type ResolveConflictDeps } from "./route";

const updateRemoteEvent = mock(async () => ({ etag: "resolved-etag" }));
// Injected, never mock.module'd — keeps the real ./client intact for client.test.ts.
const deps: ResolveConflictDeps = {
  createCaldavClient: (async () => ({})) as unknown as ResolveConflictDeps["createCaldavClient"],
  updateRemoteEvent: updateRemoteEvent as unknown as ResolveConflictDeps["updateRemoteEvent"]
};

const { upsertAccount, upsertCalendarEvent, getCalendarEventById, getCalendarEventConflict } =
  await dbModulePromise;

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Resolve Test",
    email: "owner@example.test",
    avatar: "RT",
    imap: { host: "imap.example.test", port: 993, secure: true, user: "owner@example.test", password: "secret" },
    smtp: { host: "smtp.example.test", port: 465, secure: true, user: "owner@example.test", password: "secret" },
    caldav: { url: "https://caldav.example.test/", user: "owner@example.test", password: "secret" }
  };
}

function ics(uid: string, summary: string, hhmm: string): string {
  return [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART:20260110T${hhmm}00Z`,
    `DTEND:20260110T${hhmm}00Z`,
    `SUMMARY:${summary}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\n");
}

async function setupConflict(accountId: string) {
  const account = buildAccount(accountId);
  await upsertAccount(account);
  const uid = `uid-${randomUUID()}@example.test`;
  const now = Date.UTC(2026, 0, 10, 9, 0, 0);
  const event: CalendarEvent = {
    id: `evt-${randomUUID()}`,
    accountId,
    eventUid: uid,
    summary: "Local Version",
    startAtMs: now,
    endAtMs: now + 30 * 60 * 1000,
    allDay: false,
    sourceType: "caldav",
    calendarId: "https://caldav.example.test/cal/",
    remoteHref: "https://caldav.example.test/cal/x.ics",
    remoteEtag: "etag-1",
    rawIcs: ics(uid, "Local Version", "0900"),
    pendingRemoteSync: now,
    createdAtMs: now,
    updatedAtMs: now
  };
  await upsertCalendarEvent(accountId, event);
  const localIcs = ics(uid, "Local Version", "0900");
  const remoteIcs = ics(uid, "Server Version", "1100");
  const conflict = {
    eventId: event.id,
    accountId,
    eventUid: uid,
    summary: "Local Version",
    allDay: false,
    baseIcs: ics(uid, "Original", "0900"),
    localIcs,
    remoteIcs,
    remoteEtag: "etag-2",
    detectedAtMs: now
  };
  return { account, event, conflict, localIcs, remoteIcs };
}

describe("applyConflictResolution", () => {
  beforeEach(() => updateRemoteEvent.mockClear());

  test("local: pushes the local ICS and clears the conflict", async () => {
    const accountId = `acc-resolve-local-${randomUUID()}`;
    const { account, event, conflict, localIcs } = await setupConflict(accountId);
    // Seed a conflict row so the helper's delete has something to clear.
    const { upsertCalendarEventConflict } = await dbModulePromise;
    await upsertCalendarEventConflict(accountId, conflict);

    const outcome = await applyConflictResolution(
      { accountId, event, conflict, account, resolution: "local" },
      deps
    );
    expect(outcome.ok).toBe(true);

    expect(updateRemoteEvent).toHaveBeenCalledTimes(1);
    expect(updateRemoteEvent.mock.calls[0]?.[3]).toBe(localIcs);
    const stored = await getCalendarEventById(accountId, event.id);
    expect(stored?.rawIcs).toBe(localIcs);
    expect(stored?.remoteEtag).toBe("resolved-etag");
    expect(stored?.pendingRemoteSync).toBeUndefined();
    expect(await getCalendarEventConflict(accountId, event.id)).toBeNull();
  });

  test("remote: adopts the server version without pushing", async () => {
    const accountId = `acc-resolve-remote-${randomUUID()}`;
    const { account, event, conflict, remoteIcs } = await setupConflict(accountId);
    const { upsertCalendarEventConflict } = await dbModulePromise;
    await upsertCalendarEventConflict(accountId, conflict);

    const outcome = await applyConflictResolution(
      { accountId, event, conflict, account, resolution: "remote" },
      deps
    );
    expect(outcome.ok).toBe(true);

    expect(updateRemoteEvent).not.toHaveBeenCalled();
    const stored = await getCalendarEventById(accountId, event.id);
    expect(stored?.summary).toBe("Server Version");
    expect(stored?.rawIcs).toBe(remoteIcs);
    expect(stored?.remoteEtag).toBe("etag-2");
    expect(stored?.pendingRemoteSync).toBeUndefined();
    expect(await getCalendarEventConflict(accountId, event.id)).toBeNull();
  });
});
