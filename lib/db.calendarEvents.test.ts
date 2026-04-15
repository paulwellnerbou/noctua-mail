import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account, CalendarEvent } from "./data";
import { dbModulePromise } from "./testDbHarness";

const { getCalendarEventById, upsertAccount, upsertCalendarEvent } = await dbModulePromise;

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Calendar Events Test",
    email: "owner@example.test",
    avatar: "CE",
    imap: {
      host: "imap.example.test",
      port: 993,
      secure: true,
      user: "owner@example.test",
      password: "secret"
    },
    smtp: {
      host: "smtp.example.test",
      port: 465,
      secure: true,
      user: "owner@example.test",
      password: "secret"
    }
  };
}

function buildEvent(accountId: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const now = Date.UTC(2026, 3, 14, 12, 0, 0);
  return {
    id: `evt-${randomUUID()}`,
    accountId,
    eventUid: `uid-${randomUUID()}@example.test`,
    summary: "Team sync",
    startAtMs: now,
    endAtMs: now + 30 * 60 * 1000,
    allDay: false,
    sourceType: "local",
    createdAtMs: now,
    updatedAtMs: now,
    ...overrides
  };
}

describe("upsertCalendarEvent", () => {
  test("inserts a new calendar event that is retrievable by id", async () => {
    const accountId = uniqueAccountId("acc-cal-insert");
    await upsertAccount(buildAccount(accountId));
    const event = buildEvent(accountId, { summary: "Kickoff", location: "Room 1" });

    await upsertCalendarEvent(accountId, event);
    const fetched = await getCalendarEventById(accountId, event.id);

    expect(fetched).not.toBeNull();
    expect(fetched?.eventUid).toBe(event.eventUid);
    expect(fetched?.summary).toBe("Kickoff");
    expect(fetched?.location).toBe("Room 1");
    expect(fetched?.allDay).toBe(false);
    expect(fetched?.sourceType).toBe("local");
  });

  test("replaces an existing event when upserted with the same id", async () => {
    const accountId = uniqueAccountId("acc-cal-replace");
    await upsertAccount(buildAccount(accountId));
    const event = buildEvent(accountId, { summary: "Original" });

    await upsertCalendarEvent(accountId, event);
    await upsertCalendarEvent(accountId, { ...event, summary: "Updated", location: "Room 2" });

    const fetched = await getCalendarEventById(accountId, event.id);
    expect(fetched?.summary).toBe("Updated");
    expect(fetched?.location).toBe("Room 2");
  });

  test("serializes allDay as a truthy/falsy flag round-trip", async () => {
    const accountId = uniqueAccountId("acc-cal-allday");
    await upsertAccount(buildAccount(accountId));
    const event = buildEvent(accountId, { allDay: true, endAtMs: undefined });

    await upsertCalendarEvent(accountId, event);
    const fetched = await getCalendarEventById(accountId, event.id);
    expect(fetched?.allDay).toBe(true);
  });

  test("persists occurrenceMessageIds as a JSON payload and restores it", async () => {
    const accountId = uniqueAccountId("acc-cal-occ");
    await upsertAccount(buildAccount(accountId));
    const occurrenceMessageIds = {
      [String(Date.UTC(2026, 3, 20, 12, 0, 0))]: "msg-override-1"
    };
    const event = buildEvent(accountId, { occurrenceMessageIds });

    await upsertCalendarEvent(accountId, event);
    const fetched = await getCalendarEventById(accountId, event.id);
    expect(fetched?.occurrenceMessageIds).toEqual(occurrenceMessageIds);
  });
});

describe("getCalendarEventById", () => {
  test("returns null for unknown event ids", async () => {
    const accountId = uniqueAccountId("acc-cal-missing");
    await upsertAccount(buildAccount(accountId));
    const fetched = await getCalendarEventById(accountId, "evt-does-not-exist");
    expect(fetched).toBeNull();
  });
});
