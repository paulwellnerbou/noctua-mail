import { describe, expect, mock, test } from "bun:test";
import type { CalendarEvent } from "@/lib/data";
import { saveMessageSource } from "@/lib/storage";

const getCalendarEventByUid = mock(() => Promise.resolve(null));
const listCalendarInviteSourceMessagesByEventUid = mock(() => Promise.resolve([]));
const upsertCalendarEventByUid = mock(
  async (
    accountId: string,
    fields: Omit<CalendarEvent, "id" | "accountId" | "createdAtMs" | "updatedAtMs" | "deletedAtMs">
  ) => {
    const event: CalendarEvent = {
      ...fields,
      id: `cal-${crypto.randomUUID()}`,
      accountId,
      createdAtMs: 1,
      updatedAtMs: 1
    };
    return event;
  }
);
const upsertMessageCalendarInviteStates = mock(() => Promise.resolve());
const markMessageCalendarInviteStatesProcessed = mock(() => Promise.resolve(1));
const rescheduleCalendarRemindersByEventUid = mock(() => Promise.resolve(0));
const ensureCalendarReminder = mock(() => Promise.resolve(null));
const cancelCalendarEventByUid = mock(() => Promise.resolve());
const cancelCalendarRemindersByEventUid = mock(() => Promise.resolve());

const actualDb = await import("./db");
mock.module("@/lib/db", () => ({
  ...actualDb,
  getCalendarEventByUid,
  listCalendarInviteSourceMessagesByEventUid,
  upsertCalendarEventByUid,
  upsertMessageCalendarInviteStates,
  markMessageCalendarInviteStatesProcessed,
  rescheduleCalendarRemindersByEventUid,
  ensureCalendarReminder,
  cancelCalendarEventByUid,
  cancelCalendarRemindersByEventUid
}));

const { processCalendarInviteForMessage } = await import("./calendarInviteProcessor");

mock.restore();

function makeIcs(lines: string[]) {
  return ["BEGIN:VCALENDAR", ...lines, "END:VCALENDAR"].join("\r\n");
}

describe("processCalendarInviteForMessage", () => {
  test("hydrates a missing series from an older request before applying an instance cancellation", async () => {
    getCalendarEventByUid.mockClear();
    listCalendarInviteSourceMessagesByEventUid.mockClear();
    upsertCalendarEventByUid.mockClear();
    upsertMessageCalendarInviteStates.mockClear();
    markMessageCalendarInviteStatesProcessed.mockClear();
    rescheduleCalendarRemindersByEventUid.mockClear();
    ensureCalendarReminder.mockClear();
    cancelCalendarEventByUid.mockClear();
    cancelCalendarRemindersByEventUid.mockClear();

    const baseRequestIcs = makeIcs([
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:series-uid@example.test",
      "SUMMARY:Weekly standup",
      "DTSTART:20260601T100000Z",
      "DTEND:20260601T103000Z",
      "RRULE:FREQ=WEEKLY",
      "ORGANIZER;CN=Alice:mailto:alice@example.test",
      "ATTENDEE;CN=Paul;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:paul@example.test",
      "END:VEVENT"
    ]);
    const cancelInstanceIcs = makeIcs([
      "METHOD:CANCEL",
      "BEGIN:VEVENT",
      "UID:series-uid@example.test",
      "RECURRENCE-ID:20260608T100000Z",
      "DTSTART:20260608T100000Z",
      "DTEND:20260608T103000Z",
      "STATUS:CANCELLED",
      "SEQUENCE:7",
      "END:VEVENT"
    ]);

    listCalendarInviteSourceMessagesByEventUid.mockResolvedValue([
      { messageId: "msg-base", dateValue: 1 }
    ]);
    await saveMessageSource("acc-1", "msg-base", baseRequestIcs);

    const result = await processCalendarInviteForMessage({
      accountId: "acc-1",
      messageId: "msg-cancel",
      icsSource: cancelInstanceIcs,
      process: true,
      accountEmail: "paul@example.test",
      reminderUserId: "user-1",
      processedByUserId: "user-1",
      processedAutomatically: false
    });

    expect(typeof result.states[0]?.processedAtMs).toBe("number");
    expect(result.states).toEqual([
      {
        eventUid: "series-uid@example.test",
        actionType: "cancellation",
        processed: true,
        processedAtMs: result.states[0]?.processedAtMs,
        processedAutomatically: false
      }
    ]);
    expect(listCalendarInviteSourceMessagesByEventUid).toHaveBeenCalledWith(
      "acc-1",
      "series-uid@example.test",
      { excludeMessageId: "msg-cancel" }
    );
    expect(upsertCalendarEventByUid).toHaveBeenCalledTimes(2);
    const [, bootstrappedFields] = upsertCalendarEventByUid.mock.calls[0];
    expect(bootstrappedFields.messageId).toBe("msg-base");
    expect(bootstrappedFields.recurrenceRule).toBe("FREQ=WEEKLY");

    const [, finalFields] = upsertCalendarEventByUid.mock.calls[1];
    // messageId should stay pointing to the series invite, not the occurrence cancellation
    expect(finalFields.messageId).toBe("msg-base");
    expect(finalFields.excludedDates).toContain(new Date("2026-06-08T10:00:00Z").getTime());
    expect(cancelCalendarEventByUid).not.toHaveBeenCalled();
    expect(markMessageCalendarInviteStatesProcessed).toHaveBeenCalledWith(
      "acc-1",
      "msg-cancel",
      ["series-uid@example.test"],
      {
        processedAtMs: result.states[0]?.processedAtMs,
        processedByUserId: "user-1",
        processedAutomatically: false
      }
    );
  });
});
