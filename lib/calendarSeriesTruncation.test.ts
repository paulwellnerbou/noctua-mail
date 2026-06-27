import { describe, expect, test } from "bun:test";
import { truncateRecurrenceBeforeOccurrence } from "./calendarSeriesTruncation";
import { listRecurrenceOccurrenceStartsInRange } from "./reminderRecurrence";

function occurrences(input: {
  eventStartAtMs: number;
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
  startTimezone?: string;
}) {
  return listRecurrenceOccurrenceStartsInRange(
    input,
    input.eventStartAtMs - 14 * 24 * 3600 * 1000,
    input.eventStartAtMs + 120 * 24 * 3600 * 1000
  );
}

describe("truncateRecurrenceBeforeOccurrence", () => {
  // The cutoff occurrence and everything after it must vanish from the
  // expanded series, while the occurrence right before it survives — across
  // positive-offset, negative-offset, and floating zones, since UNTIL is
  // compared against wall-clock-shifted occurrence starts.
  const cases = [
    { tz: "Europe/Berlin", start: Date.UTC(2026, 5, 26, 10, 0), cutoff: Date.UTC(2026, 6, 10, 10, 0) },
    { tz: "America/New_York", start: Date.UTC(2026, 5, 26, 16, 0), cutoff: Date.UTC(2026, 6, 10, 16, 0) },
    { tz: "", start: Date.UTC(2026, 5, 26, 12, 0), cutoff: Date.UTC(2026, 6, 10, 12, 0) }
  ];

  for (const { tz, start, cutoff } of cases) {
    test(`drops the cutoff occurrence and all later ones (tz=${tz || "floating"})`, () => {
      const result = truncateRecurrenceBeforeOccurrence(
        { recurrenceRule: "FREQ=WEEKLY;BYDAY=FR", startTimezone: tz },
        cutoff
      );
      const remaining = occurrences({
        eventStartAtMs: start,
        recurrenceRule: result.recurrenceRule,
        startTimezone: tz
      });
      expect(remaining).toContain(start);
      expect(remaining).toContain(cutoff - 7 * 24 * 3600 * 1000);
      expect(remaining).not.toContain(cutoff);
      expect(Math.max(...remaining)).toBeLessThan(cutoff);
    });
  }

  test("injects UNTIL into a rule that has none", () => {
    const result = truncateRecurrenceBeforeOccurrence(
      { recurrenceRule: "FREQ=DAILY" },
      Date.UTC(2026, 0, 10)
    );
    expect(result.recurrenceRule).toMatch(/UNTIL=20260109T235959Z/);
  });

  test("replaces COUNT with UNTIL (mutually exclusive per RFC 5545)", () => {
    const result = truncateRecurrenceBeforeOccurrence(
      { recurrenceRule: "FREQ=DAILY;COUNT=20" },
      Date.UTC(2026, 0, 10)
    );
    expect(result.recurrenceRule).not.toMatch(/COUNT=/);
    expect(result.recurrenceRule).toMatch(/UNTIL=/);
  });

  test("trims RDATE and EXDATE entries at or after the cutoff", () => {
    const cutoff = Date.UTC(2026, 0, 10);
    const result = truncateRecurrenceBeforeOccurrence(
      {
        recurrenceRule: "FREQ=WEEKLY",
        recurrenceDates: [Date.UTC(2026, 0, 5), cutoff, Date.UTC(2026, 0, 20)],
        excludedDates: [Date.UTC(2026, 0, 6), cutoff + 1000]
      },
      cutoff
    );
    expect(result.recurrenceDates).toEqual([Date.UTC(2026, 0, 5)]);
    expect(result.excludedDates).toEqual([Date.UTC(2026, 0, 6)]);
  });

  test("leaves an unparseable rule untouched but still trims date lists", () => {
    const cutoff = Date.UTC(2026, 0, 10);
    const result = truncateRecurrenceBeforeOccurrence(
      { recurrenceRule: "NOT A RULE", recurrenceDates: [Date.UTC(2026, 0, 5), cutoff] },
      cutoff
    );
    expect(result.recurrenceRule).toBe("NOT A RULE");
    expect(result.recurrenceDates).toEqual([Date.UTC(2026, 0, 5)]);
  });

  test("returns undefined date lists when nothing survives", () => {
    const cutoff = Date.UTC(2026, 0, 10);
    const result = truncateRecurrenceBeforeOccurrence(
      { recurrenceRule: "FREQ=DAILY", recurrenceDates: [cutoff], excludedDates: [cutoff] },
      cutoff
    );
    expect(result.recurrenceDates).toBeUndefined();
    expect(result.excludedDates).toBeUndefined();
  });
});
