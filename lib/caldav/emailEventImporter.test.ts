import { describe, expect, mock, test } from "bun:test";

const upsertCalendarEventByUid = mock(() => Promise.resolve({ id: "cal-test" } as any));
const cancelCalendarEventByUid = mock(() => Promise.resolve());

mock.module("@/lib/db", () => ({
  upsertCalendarEventByUid,
  cancelCalendarEventByUid
}));

const { importEmailCalendarEvents } = await import("./emailEventImporter");

function makeIcs(lines: string[]) {
  return ["BEGIN:VCALENDAR", ...lines, "END:VCALENDAR"].join("\r\n");
}

describe("importEmailCalendarEvents", () => {
  test("imports a basic event", async () => {
    upsertCalendarEventByUid.mockClear();
    cancelCalendarEventByUid.mockClear();

    const ics = makeIcs([
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:basic-uid@example.test",
      "SUMMARY:Team Meeting",
      "DTSTART:20260601T100000Z",
      "DTEND:20260601T110000Z",
      "LOCATION:Conference Room",
      "ORGANIZER;CN=Alice:mailto:alice@example.test",
      "END:VEVENT"
    ]);

    await importEmailCalendarEvents("acc-1", "msg-1", ics);

    expect(upsertCalendarEventByUid).toHaveBeenCalledTimes(1);
    expect(cancelCalendarEventByUid).not.toHaveBeenCalled();

    const [accountId, fields] = upsertCalendarEventByUid.mock.calls[0];
    expect(accountId).toBe("acc-1");
    expect(fields.eventUid).toBe("basic-uid@example.test");
    expect(fields.summary).toBe("Team Meeting");
    expect(fields.location).toBe("Conference Room");
    expect(fields.sourceType).toBe("email");
    expect(fields.status).toBe("TENTATIVE");
    expect(fields.messageId).toBe("msg-1");
    expect(fields.rawIcs).toBe(ics);
    expect(fields.allDay).toBe(false);
    expect(fields.startAtMs).toBe(new Date("2026-06-01T10:00:00Z").getTime());
  });

  test("forces TENTATIVE status regardless of ICS STATUS field", async () => {
    upsertCalendarEventByUid.mockClear();

    const ics = makeIcs([
      "BEGIN:VEVENT",
      "UID:confirmed-uid@example.test",
      "SUMMARY:Confirmed Event",
      "DTSTART:20260601T100000Z",
      "STATUS:CONFIRMED",
      "END:VEVENT"
    ]);

    await importEmailCalendarEvents("acc-1", "msg-2", ics);

    const [, fields] = upsertCalendarEventByUid.mock.calls[0];
    expect(fields.status).toBe("TENTATIVE");
  });

  test("cancels whole event on METHOD:CANCEL", async () => {
    upsertCalendarEventByUid.mockClear();
    cancelCalendarEventByUid.mockClear();

    const ics = makeIcs([
      "METHOD:CANCEL",
      "BEGIN:VEVENT",
      "UID:cancel-uid@example.test",
      "SUMMARY:Cancelled Meeting",
      "DTSTART:20260601T100000Z",
      "END:VEVENT"
    ]);

    await importEmailCalendarEvents("acc-1", "msg-3", ics);

    expect(cancelCalendarEventByUid).toHaveBeenCalledTimes(1);
    expect(cancelCalendarEventByUid).toHaveBeenCalledWith("acc-1", "cancel-uid@example.test");
    expect(upsertCalendarEventByUid).not.toHaveBeenCalled();
  });

  test("cancels whole event on STATUS:CANCELLED", async () => {
    upsertCalendarEventByUid.mockClear();
    cancelCalendarEventByUid.mockClear();

    const ics = makeIcs([
      "BEGIN:VEVENT",
      "UID:status-cancel-uid@example.test",
      "SUMMARY:Meeting",
      "DTSTART:20260601T100000Z",
      "STATUS:CANCELLED",
      "END:VEVENT"
    ]);

    await importEmailCalendarEvents("acc-1", "msg-4", ics);

    expect(cancelCalendarEventByUid).toHaveBeenCalledWith("acc-1", "status-cancel-uid@example.test");
    expect(upsertCalendarEventByUid).not.toHaveBeenCalled();
  });

  test("handles RECURRENCE-ID cancellation by adding to excludedDates", async () => {
    upsertCalendarEventByUid.mockClear();
    cancelCalendarEventByUid.mockClear();

    const ics = makeIcs([
      "METHOD:CANCEL",
      "BEGIN:VEVENT",
      "UID:recur-uid@example.test",
      "SUMMARY:Weekly standup",
      "DTSTART:20260601T100000Z",
      "RECURRENCE-ID:20260608T100000Z",
      "END:VEVENT"
    ]);

    await importEmailCalendarEvents("acc-1", "msg-5", ics);

    // Should NOT cancel the whole event, just update excludedDates
    expect(cancelCalendarEventByUid).not.toHaveBeenCalled();
    // No base event → no upsert either (instance-only cancel without base)
    expect(upsertCalendarEventByUid).not.toHaveBeenCalled();
  });

  test("merges RECURRENCE-ID reschedule into excludedDates and recurrenceDates", async () => {
    upsertCalendarEventByUid.mockClear();
    cancelCalendarEventByUid.mockClear();

    const ics = makeIcs([
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:recur-uid@example.test",
      "SUMMARY:Weekly standup",
      "DTSTART:20260601T100000Z",
      "DTEND:20260601T103000Z",
      "RRULE:FREQ=WEEKLY",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:recur-uid@example.test",
      "SUMMARY:Weekly standup (moved)",
      "DTSTART:20260608T130000Z",
      "DTEND:20260608T133000Z",
      "RECURRENCE-ID:20260608T100000Z",
      "END:VEVENT"
    ]);

    await importEmailCalendarEvents("acc-1", "msg-6", ics);

    expect(upsertCalendarEventByUid).toHaveBeenCalledTimes(1);
    const [, fields] = upsertCalendarEventByUid.mock.calls[0];
    expect(fields.recurrenceRule).toBe("FREQ=WEEKLY");
    expect(fields.excludedDates).toContain(new Date("2026-06-08T10:00:00Z").getTime());
    expect(fields.recurrenceDates).toContain(new Date("2026-06-08T13:00:00Z").getTime());
  });

  test("handles all-day events correctly", async () => {
    upsertCalendarEventByUid.mockClear();

    const ics = makeIcs([
      "BEGIN:VEVENT",
      "UID:allday-uid@example.test",
      "SUMMARY:Holiday",
      "DTSTART;VALUE=DATE:20260601",
      "DTEND;VALUE=DATE:20260602",
      "END:VEVENT"
    ]);

    await importEmailCalendarEvents("acc-1", "msg-7", ics);

    const [, fields] = upsertCalendarEventByUid.mock.calls[0];
    expect(fields.allDay).toBe(true);
  });

  test("silently ignores empty ICS source", async () => {
    upsertCalendarEventByUid.mockClear();
    cancelCalendarEventByUid.mockClear();

    await importEmailCalendarEvents("acc-1", "msg-8", "");
    await importEmailCalendarEvents("acc-1", "msg-9", "   ");

    expect(upsertCalendarEventByUid).not.toHaveBeenCalled();
    expect(cancelCalendarEventByUid).not.toHaveBeenCalled();
  });
});
