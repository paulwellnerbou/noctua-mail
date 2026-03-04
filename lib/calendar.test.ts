import { describe, expect, test } from "bun:test";
import { buildCalendarRecurrenceSummary } from "./calendar";

describe("buildCalendarRecurrenceSummary", () => {
  test("orders start before until for recurring events", () => {
    const summary = buildCalendarRecurrenceSummary({
      allDay: false,
      start: new Date("2026-03-11T10:00:00.000Z"),
      startTimezone: "Europe/Berlin",
      recurrenceRule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;UNTIL=20260902T090000Z"
    });

    expect(summary).toContain("Every 2 weeks on Wednesday, starting");
    expect(summary).toContain("until");
    expect(summary?.indexOf("starting")).toBeLessThan(summary?.indexOf("until") ?? 0);
  });
});
