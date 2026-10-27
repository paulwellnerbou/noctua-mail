import { beforeAll, describe, expect, test } from "bun:test";
import type { Account, CalendarEvent } from "./data";
import { dbModulePromise } from "./testDbHarness";

const ACCOUNT_ID = "acc-calendar-event-list-columns";
const START_AT_MS = Date.UTC(2026, 9, 27, 9, 0, 0);

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Test Account",
    email: "owner@example.com",
    avatar: "",
    imap: {
      host: "imap.example.com",
      port: 993,
      secure: true,
      user: "owner@example.com",
      password: "secret"
    },
    smtp: {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "owner@example.com",
      password: "secret"
    }
  };
}

function buildEvent(): CalendarEvent {
  return {
    id: "cal-list-columns-1",
    accountId: ACCOUNT_ID,
    eventUid: "list-columns@example.com",
    summary: "Weekly sync",
    location: "Room 1",
    startAtMs: START_AT_MS,
    endAtMs: START_AT_MS + 60 * 60 * 1000,
    allDay: false,
    sourceType: "email",
    messageId: "invite-message-1",
    rawIcs: "BEGIN:VCALENDAR\r\nEND:VCALENDAR",
    sourceSubject: "Invitation: Weekly sync",
    sourceBodyText: "Plain text invitation body",
    sourceBodyHtml: "<p>HTML invitation body</p>",
    occurrenceSnapshots: {
      [String(START_AT_MS)]: { sourceSubject: "Updated invitation: Weekly sync" }
    },
    createdAtMs: START_AT_MS,
    updatedAtMs: START_AT_MS
  };
}

describe("listCalendarEvents", () => {
  beforeAll(async () => {
    const { upsertAccount, upsertCalendarEvent } = await dbModulePromise;
    await upsertAccount(buildAccount(ACCOUNT_ID));
    await upsertCalendarEvent(ACCOUNT_ID, buildEvent());
  });

  test("leaves the blob columns to the by-id lookup", async () => {
    const { listCalendarEvents, getCalendarEventById } = await dbModulePromise;
    const event = buildEvent();

    const listed = await listCalendarEvents(ACCOUNT_ID, START_AT_MS - 1, START_AT_MS + 1);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: event.id,
      eventUid: event.eventUid,
      summary: event.summary,
      location: event.location,
      startAtMs: event.startAtMs,
      endAtMs: event.endAtMs,
      sourceType: event.sourceType,
      messageId: event.messageId,
      sourceSubject: event.sourceSubject
    });
    expect(listed[0].rawIcs).toBeUndefined();
    expect(listed[0].sourceBodyText).toBeUndefined();
    expect(listed[0].sourceBodyHtml).toBeUndefined();
    expect(listed[0].occurrenceSnapshots).toBeUndefined();

    const full = await getCalendarEventById(ACCOUNT_ID, event.id);
    expect(full?.rawIcs).toBe(event.rawIcs);
    expect(full?.sourceBodyText).toBe(event.sourceBodyText);
    expect(full?.sourceBodyHtml).toBe(event.sourceBodyHtml);
    expect(full?.occurrenceSnapshots).toEqual(event.occurrenceSnapshots);
  });
});
