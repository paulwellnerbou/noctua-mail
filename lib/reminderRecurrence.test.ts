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
});
