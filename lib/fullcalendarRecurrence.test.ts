import { describe, expect, it } from "bun:test";
import { RRule } from "rrule";
import { buildFullCalendarRecurringFields } from "./fullcalendarRecurrence";

describe("buildFullCalendarRecurringFields", () => {
  it("builds valid FullCalendar rrule object fields from stored recurrence data", () => {
    const recurring = buildFullCalendarRecurringFields({
      startAtMs: Date.UTC(2026, 2, 3, 9, 30, 0),
      endAtMs: Date.UTC(2026, 2, 3, 10, 15, 0),
      recurrenceRule: "FREQ=WEEKLY;BYDAY=TU,TH",
      excludedDates: [Date.UTC(2026, 2, 10, 9, 30, 0)]
    });

    expect(recurring).not.toBeNull();
    expect(recurring?.rrule.dtstart).toEqual(new Date("2026-03-03T09:30:00.000Z"));
    expect("rrule" in (recurring?.rrule ?? {})).toBe(false);
    expect(recurring?.duration).toEqual({ milliseconds: 45 * 60 * 1000 });
    expect(recurring?.exdate).toEqual([new Date("2026-03-10T09:30:00.000Z")]);

    expect(() => new RRule(recurring!.rrule)).not.toThrow();
  });

  it("returns null when no recurrence rule exists", () => {
    expect(
      buildFullCalendarRecurringFields({
        startAtMs: Date.UTC(2026, 2, 3, 9, 30, 0),
        endAtMs: undefined,
        recurrenceRule: undefined,
        excludedDates: undefined
      })
    ).toBeNull();
  });
});
