import { describe, expect, test } from "bun:test";
import { expandCalendarEventForRange, filterCalendarReminderDuplicates } from "./calendarOccurrences";
import type { CalendarEvent, CalendarReminder } from "./data";

function buildEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "cal-1",
    accountId: "acc-1",
    eventUid: "uid-1",
    summary: "Series",
    startAtMs: Date.UTC(2026, 2, 11, 14, 30, 0),
    endAtMs: Date.UTC(2026, 2, 11, 15, 15, 0),
    allDay: false,
    startTimezone: "Europe/Berlin",
    recurrenceRule: "FREQ=WEEKLY;UNTIL=20260902T133000Z;INTERVAL=2;BYDAY=WE;WKST=MO",
    sourceType: "email",
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides
  };
}

function buildReminder(overrides: Partial<CalendarReminder> = {}): CalendarReminder {
  return {
    id: "rem-1",
    accountId: "acc-1",
    userId: "user-1",
    eventUid: "uid-1",
    eventTitle: "Series",
    eventStartAtMs: Date.UTC(2026, 2, 11, 14, 30, 0),
    eventEndAtMs: Date.UTC(2026, 2, 11, 15, 15, 0),
    nextEventStartAtMs: Date.UTC(2026, 2, 11, 14, 30, 0),
    leadMinutes: 15,
    leadLabel: "15 minutes before",
    triggerAtMs: Date.UTC(2026, 2, 11, 14, 15, 0),
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides
  };
}

describe("calendar occurrence expansion", () => {
  test("keeps Europe/Berlin recurring events at wall clock time across DST", () => {
    const occurrences = expandCalendarEventForRange(
      buildEvent(),
      Date.UTC(2026, 2, 1, 0, 0, 0),
      Date.UTC(2026, 3, 15, 0, 0, 0)
    );

    expect(occurrences.map((item) => item.displayStartAtMs)).toEqual([
      Date.UTC(2026, 2, 11, 14, 30, 0),
      Date.UTC(2026, 2, 25, 14, 30, 0),
      Date.UTC(2026, 3, 8, 13, 30, 0)
    ]);
    expect(occurrences.map((item) => item.displayEndAtMs)).toEqual([
      Date.UTC(2026, 2, 11, 15, 15, 0),
      Date.UTC(2026, 2, 25, 15, 15, 0),
      Date.UTC(2026, 3, 8, 14, 15, 0)
    ]);
  });
});

describe("calendar reminder dedupe", () => {
  test("hides reminder entries when the source event is already visible", () => {
    const visibleEvents = expandCalendarEventForRange(
      buildEvent(),
      Date.UTC(2026, 2, 1, 0, 0, 0),
      Date.UTC(2026, 2, 31, 0, 0, 0)
    );
    const reminders = [
      buildReminder(),
      buildReminder({
        id: "rem-2",
        eventUid: "uid-2",
        eventTitle: "Other series"
      })
    ];

    const filtered = filterCalendarReminderDuplicates(reminders, visibleEvents);

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("rem-2");
  });
});
