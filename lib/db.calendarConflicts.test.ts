import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account } from "./data";
import type { CalendarEventConflict } from "./db";
import { dbModulePromise } from "./testDbHarness";

const { upsertAccount, upsertCalendarEventConflict, getCalendarEventConflict } = await dbModulePromise;

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Conflicts Test",
    email: "owner@example.test",
    avatar: "CT",
    imap: { host: "imap.example.test", port: 993, secure: true, user: "owner@example.test", password: "secret" },
    smtp: { host: "smtp.example.test", port: 465, secure: true, user: "owner@example.test", password: "secret" }
  };
}

function buildConflict(accountId: string, eventId: string, overrides: Partial<CalendarEventConflict> = {}): CalendarEventConflict {
  return {
    eventId,
    accountId,
    eventUid: "uid@example.test",
    summary: "Original",
    allDay: false,
    baseIcs: "BASE",
    localIcs: "LOCAL",
    remoteIcs: "REMOTE",
    remoteEtag: "etag-1",
    detectedAtMs: 1000,
    ...overrides
  };
}

describe("upsertCalendarEventConflict", () => {
  test("preserves the original detectedAtMs on re-upsert while refreshing snapshots", async () => {
    const accountId = `acc-conflict-${randomUUID()}`;
    await upsertAccount(buildAccount(accountId));
    const eventId = `evt-${randomUUID()}`;

    await upsertCalendarEventConflict(accountId, buildConflict(accountId, eventId, { detectedAtMs: 1000 }));
    await upsertCalendarEventConflict(
      accountId,
      buildConflict(accountId, eventId, { detectedAtMs: 5000, remoteIcs: "REMOTE-2", remoteEtag: "etag-2" })
    );

    const stored = await getCalendarEventConflict(accountId, eventId);
    expect(stored?.detectedAtMs).toBe(1000); // original kept for stable ordering
    expect(stored?.remoteIcs).toBe("REMOTE-2"); // snapshots refreshed
    expect(stored?.remoteEtag).toBe("etag-2");
  });
});
