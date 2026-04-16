import { describe, expect, mock, test } from "bun:test";
import type { CalendarEvent, Message } from "@/lib/data";
import type { CalendarEventEmailSnapshot } from "@/lib/calendarEventEmailSnapshot";
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

// Mock the snapshot helper rather than `@/lib/db.getMessageById` itself —
// bun's module mocks are global, so overriding `getMessageById` would leak
// into later test files (e.g. the source-route test that also reads
// messages via the real DB). The wrapper is the only thing the processor
// actually uses, so this keeps the mock scope tight.
const buildCalendarEventEmailSnapshotFromMessageId = mock(
  async (_accountId: string, _messageId: string): Promise<CalendarEventEmailSnapshot | null> =>
    null
);
const messagesByIdForSnapshot = new Map<string, Message>();
function configureSnapshotMessageFixtures(messages: Message[]) {
  messagesByIdForSnapshot.clear();
  for (const msg of messages) messagesByIdForSnapshot.set(msg.id, msg);
  buildCalendarEventEmailSnapshotFromMessageId.mockImplementation(
    async (_accountId: string, messageId: string) => {
      const msg = messagesByIdForSnapshot.get(messageId);
      if (!msg) return null;
      return {
        sourceSubject: msg.subject,
        sourceFromAddr: msg.from,
        sourceToAddr: msg.to,
        sourceCcAddr: msg.cc,
        sourceBccAddr: msg.bcc,
        sourceDateMs: msg.dateValue,
        sourceBodyText: msg.body,
        sourceBodyHtml: msg.htmlBody
      };
    }
  );
}

mock.module("@/lib/calendarEventEmailSnapshot.server", () => ({
  buildCalendarEventEmailSnapshotFromMessageId
}));

const { processCalendarInviteForMessage } = await import("./calendarInviteProcessor");

mock.restore();

function makeIcs(lines: string[]) {
  return ["BEGIN:VCALENDAR", ...lines, "END:VCALENDAR"].join("\r\n");
}

describe("processCalendarInviteForMessage", () => {
  test("hard deletes a whole-event cancellation without rebuilding the event", async () => {
    getCalendarEventByUid.mockClear();
    listCalendarInviteSourceMessagesByEventUid.mockClear();
    upsertCalendarEventByUid.mockClear();
    upsertMessageCalendarInviteStates.mockClear();
    markMessageCalendarInviteStatesProcessed.mockClear();
    rescheduleCalendarRemindersByEventUid.mockClear();
    ensureCalendarReminder.mockClear();
    cancelCalendarEventByUid.mockClear();
    cancelCalendarRemindersByEventUid.mockClear();

    const cancelIcs = makeIcs([
      "METHOD:CANCEL",
      "BEGIN:VEVENT",
      "UID:series-uid@example.test",
      "SUMMARY:Cancelled Weekly standup",
      "DTSTART:20260601T100000Z",
      "DTEND:20260601T103000Z",
      "STATUS:CANCELLED",
      "SEQUENCE:7",
      "END:VEVENT"
    ]);

    const result = await processCalendarInviteForMessage({
      accountId: "acc-1",
      messageId: "msg-cancel-series",
      icsSource: cancelIcs,
      process: true,
      accountEmail: "paul@example.test",
      reminderUserId: "user-1",
      processedByUserId: "user-1",
      processedAutomatically: false
    });

    expect(result.states).toEqual([
      {
        eventUid: "series-uid@example.test",
        actionType: "cancellation",
        processed: true,
        processedAtMs: result.states[0]?.processedAtMs,
        processedAutomatically: false
      }
    ]);
    expect(cancelCalendarEventByUid).toHaveBeenCalledWith("acc-1", "series-uid@example.test");
    expect(cancelCalendarRemindersByEventUid).toHaveBeenCalledWith(
      "acc-1",
      "series-uid@example.test"
    );
    expect(upsertCalendarEventByUid).not.toHaveBeenCalled();
    expect(markMessageCalendarInviteStatesProcessed).toHaveBeenCalledWith(
      "acc-1",
      "msg-cancel-series",
      ["series-uid@example.test"],
      {
        processedAtMs: result.states[0]?.processedAtMs,
        processedByUserId: "user-1",
        processedAutomatically: false
      }
    );
  });

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

  test("captures a per-occurrence snapshot when a REQUEST reschedules one occurrence", async () => {
    getCalendarEventByUid.mockClear();
    listCalendarInviteSourceMessagesByEventUid.mockClear();
    upsertCalendarEventByUid.mockClear();
    upsertMessageCalendarInviteStates.mockClear();
    markMessageCalendarInviteStatesProcessed.mockClear();
    rescheduleCalendarRemindersByEventUid.mockClear();
    ensureCalendarReminder.mockClear();
    cancelCalendarEventByUid.mockClear();
    cancelCalendarRemindersByEventUid.mockClear();
    buildCalendarEventEmailSnapshotFromMessageId.mockClear();

    // Existing series event — 10am every Monday starting Jun 1.
    const existingSeries: CalendarEvent = {
      id: "cal-existing",
      accountId: "acc-1",
      eventUid: "series-uid@example.test",
      summary: "Weekly standup",
      startAtMs: Date.UTC(2026, 5, 1, 10, 0, 0),
      endAtMs: Date.UTC(2026, 5, 1, 10, 30, 0),
      allDay: false,
      recurrenceRule: "FREQ=WEEKLY",
      sourceType: "email",
      messageId: "msg-series-invite",
      createdAtMs: 1,
      updatedAtMs: 1
    };
    getCalendarEventByUid.mockResolvedValue(existingSeries);

    // Seed two messages — the original series invite (for the series
    // snapshot fallback) and the new reschedule email (for the
    // per-occurrence snapshot).
    const seriesDate = Date.UTC(2026, 4, 20, 9, 0, 0);
    const rescheduleDate = Date.UTC(2026, 5, 7, 14, 0, 0);
    configureSnapshotMessageFixtures([
      {
        id: "msg-series-invite",
        threadId: "t1",
        accountId: "acc-1",
        folderId: "acc-1:INBOX",
        subject: "Invite: Weekly standup",
        from: "alice@example.test",
        to: "paul@example.test",
        preview: "",
        date: new Date(seriesDate).toISOString(),
        dateValue: seriesDate,
        body: "series body",
        htmlBody: "<p>series body</p>"
      },
      {
        id: "msg-reschedule",
        threadId: "t2",
        accountId: "acc-1",
        folderId: "acc-1:INBOX",
        subject: "Updated: Weekly standup (Jun 8 moved to 4pm)",
        from: "alice@example.test",
        to: "paul@example.test",
        preview: "",
        date: new Date(rescheduleDate).toISOString(),
        dateValue: rescheduleDate,
        body: "moved to 4pm this week",
        htmlBody: "<p>moved to 4pm this week</p>"
      }
    ]);

    // REQUEST with RECURRENCE-ID pointing at the Jun 8 occurrence,
    // rescheduling it to 16:00 the same day.
    const rescheduleIcs = makeIcs([
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:series-uid@example.test",
      "RECURRENCE-ID:20260608T100000Z",
      "DTSTART:20260608T160000Z",
      "DTEND:20260608T163000Z",
      "SUMMARY:Weekly standup",
      "SEQUENCE:1",
      "END:VEVENT"
    ]);

    await processCalendarInviteForMessage({
      accountId: "acc-1",
      messageId: "msg-reschedule",
      icsSource: rescheduleIcs,
      process: true,
      accountEmail: "paul@example.test",
      reminderUserId: "user-1",
      processedByUserId: "user-1",
      processedAutomatically: true
    });

    expect(upsertCalendarEventByUid).toHaveBeenCalledTimes(1);
    const [, fields] = upsertCalendarEventByUid.mock.calls[0];
    const newOccKey = String(Date.UTC(2026, 5, 8, 16, 0, 0));

    // occurrenceMessageIds should point the rescheduled occurrence at the new email.
    expect(fields.occurrenceMessageIds?.[newOccKey]).toBe("msg-reschedule");

    // Per-occurrence snapshot must be captured from the reschedule email,
    // not from the series invite.
    const occSnapshot = fields.occurrenceSnapshots?.[newOccKey];
    expect(occSnapshot?.sourceSubject).toBe(
      "Updated: Weekly standup (Jun 8 moved to 4pm)"
    );
    expect(occSnapshot?.sourceBodyText).toBe("moved to 4pm this week");
    expect(occSnapshot?.sourceDateMs).toBe(rescheduleDate);

    // Series-level messageId must still point to the original invite,
    // so "Open series email" keeps working.
    expect(fields.messageId).toBe("msg-series-invite");
  });

  test("skips occurrenceSnapshots for a plain series REQUEST (no RECURRENCE-ID)", async () => {
    getCalendarEventByUid.mockClear();
    listCalendarInviteSourceMessagesByEventUid.mockClear();
    upsertCalendarEventByUid.mockClear();
    upsertMessageCalendarInviteStates.mockClear();
    markMessageCalendarInviteStatesProcessed.mockClear();
    rescheduleCalendarRemindersByEventUid.mockClear();
    ensureCalendarReminder.mockClear();
    cancelCalendarEventByUid.mockClear();
    cancelCalendarRemindersByEventUid.mockClear();
    buildCalendarEventEmailSnapshotFromMessageId.mockClear();

    getCalendarEventByUid.mockResolvedValue(null);
    const seriesDate = Date.UTC(2026, 4, 20, 9, 0, 0);
    configureSnapshotMessageFixtures([
      {
        id: "msg-new-series",
        threadId: "t1",
        accountId: "acc-1",
        folderId: "acc-1:INBOX",
        subject: "Invite: Kickoff",
        from: "alice@example.test",
        to: "paul@example.test",
        preview: "",
        date: new Date(seriesDate).toISOString(),
        dateValue: seriesDate,
        body: "kickoff"
      }
    ]);

    const requestIcs = makeIcs([
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:kickoff@example.test",
      "DTSTART:20260610T100000Z",
      "DTEND:20260610T110000Z",
      "SUMMARY:Kickoff",
      "END:VEVENT"
    ]);

    await processCalendarInviteForMessage({
      accountId: "acc-1",
      messageId: "msg-new-series",
      icsSource: requestIcs,
      process: true,
      accountEmail: "paul@example.test"
    });

    expect(upsertCalendarEventByUid).toHaveBeenCalledTimes(1);
    const [, fields] = upsertCalendarEventByUid.mock.calls[0];
    // No RECURRENCE-ID → no per-occurrence snapshot map.
    expect(fields.occurrenceSnapshots).toBeUndefined();
    // Series-level snapshot still populated from the incoming email.
    expect(fields.sourceSubject).toBe("Invite: Kickoff");
  });
});
