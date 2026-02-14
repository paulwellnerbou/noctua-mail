import { describe, expect, test } from "bun:test";
import { collectCalendarReminderMutationsFromCalendarInvite } from "./calendarReminderMutations";

describe("calendar reminder mutations", () => {
  test("merges RECURRENCE-ID moves into series recurrence updates", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:demo-uid@example.test",
      "SUMMARY:Weekly standup",
      "DTSTART:20260401T100000Z",
      "DTEND:20260401T103000Z",
      "RRULE:FREQ=WEEKLY",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:demo-uid@example.test",
      "RECURRENCE-ID:20260408T100000Z",
      "SUMMARY:Weekly standup (moved)",
      "DTSTART:20260408T130000Z",
      "DTEND:20260408T133000Z",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const mutations = collectCalendarReminderMutationsFromCalendarInvite(ics, "msg-1");
    expect(mutations).toHaveLength(1);
    const update = mutations[0];
    expect(update.kind).toBe("update");
    if (update.kind !== "update") return;
    expect(update.eventUid).toBe("demo-uid@example.test");
    expect(update.recurrenceRule).toBe("FREQ=WEEKLY");
    expect(update.recurrenceDates).toEqual([1775653200000]);
    expect(update.excludedDates).toEqual([1775642400000]);
  });

  test("does not emit one-off updates for instance-only RECURRENCE-ID invites", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:demo-uid@example.test",
      "RECURRENCE-ID:20260408T100000Z",
      "SUMMARY:Weekly standup (moved)",
      "DTSTART:20260408T130000Z",
      "DTEND:20260408T133000Z",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const mutations = collectCalendarReminderMutationsFromCalendarInvite(ics, "msg-2");
    expect(mutations).toHaveLength(0);
  });

  test("keeps whole-event cancellation behavior when no RECURRENCE-ID is present", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "METHOD:CANCEL",
      "BEGIN:VEVENT",
      "UID:demo-uid@example.test",
      "SUMMARY:Weekly standup",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const mutations = collectCalendarReminderMutationsFromCalendarInvite(ics, "msg-3");
    expect(mutations).toEqual([{ kind: "cancel", eventUid: "demo-uid@example.test" }]);
  });
});
