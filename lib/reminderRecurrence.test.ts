import { describe, expect, test } from "bun:test";
import { resolveNextReminderOccurrence } from "./reminderRecurrence";

describe("reminder recurrence timezone scheduling", () => {
  test("keeps weekly recurrence at local wall clock time across DST", () => {
    const occurrence = resolveNextReminderOccurrence(
      {
        eventStartAtMs: Date.UTC(2026, 2, 2, 14, 0, 0),
        leadMinutes: 0,
        recurrenceRule: "FREQ=WEEKLY;COUNT=6",
        startTimezone: "/America/New_York"
      },
      Date.UTC(2026, 2, 8, 12, 0, 0)
    );
    expect(occurrence).not.toBeNull();
    expect(occurrence?.eventStartAtMs).toBe(Date.UTC(2026, 2, 9, 13, 0, 0));
    expect(occurrence?.triggerAtMs).toBe(Date.UTC(2026, 2, 9, 13, 0, 0));
  });

  test("keeps current recurring occurrence while the event is in progress", () => {
    const eventStartAtMs = Date.UTC(2026, 0, 5, 15, 0, 0);
    const eventEndAtMs = Date.UTC(2026, 0, 5, 16, 0, 0);
    const occurrence = resolveNextReminderOccurrence(
      {
        eventStartAtMs,
        eventEndAtMs,
        leadMinutes: 15,
        recurrenceRule: "FREQ=WEEKLY;COUNT=4"
      },
      Date.UTC(2026, 0, 5, 15, 30, 0)
    );
    expect(occurrence).not.toBeNull();
    expect(occurrence?.eventStartAtMs).toBe(eventStartAtMs);
    expect(occurrence?.triggerAtMs).toBe(Date.UTC(2026, 0, 5, 14, 45, 0));
  });
});
