import { describe, expect, test } from "bun:test";
import { resolveNextReminderOccurrence } from "./reminderRecurrence";

function resolveOccurrenceInSubprocess(timeZone: string) {
  const evalSource = `
    import { resolveNextReminderOccurrence } from "./lib/reminderRecurrence";
    const reminder = {
      eventStartAtMs: Date.UTC(2025, 10, 11, 9, 45, 0),
      leadMinutes: 0,
      recurrenceRule: "FREQ=WEEKLY;BYDAY=TU,WE,TH,FR;WKST=SU",
      startTimezone: "Europe/Berlin"
    };
    const occurrence = resolveNextReminderOccurrence(reminder, Date.UTC(2025, 10, 10, 12, 0, 0));
    process.stdout.write(String(occurrence?.eventStartAtMs ?? "null"));
  `;
  const result = Bun.spawnSync({
    cmd: ["bun", "-e", evalSource],
    cwd: process.cwd(),
    env: { ...process.env, TZ: timeZone },
    stdout: "pipe",
    stderr: "pipe"
  });
  return {
    exitCode: result.exitCode,
    stdout: Buffer.from(result.stdout).toString("utf8").trim(),
    stderr: Buffer.from(result.stderr).toString("utf8").trim()
  };
}

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

  test("keeps Europe/Berlin recurrence at 10:45 local wall time", () => {
    const occurrence = resolveNextReminderOccurrence(
      {
        eventStartAtMs: Date.UTC(2025, 10, 11, 9, 45, 0),
        leadMinutes: 0,
        recurrenceRule: "FREQ=WEEKLY;BYDAY=TU,WE,TH,FR;WKST=SU",
        startTimezone: "Europe/Berlin"
      },
      Date.UTC(2025, 10, 10, 12, 0, 0)
    );
    expect(occurrence).not.toBeNull();
    expect(occurrence?.eventStartAtMs).toBe(Date.UTC(2025, 10, 11, 9, 45, 0));
  });

  test("returns the same recurring instant regardless of process TZ", () => {
    const utc = resolveOccurrenceInSubprocess("UTC");
    const berlin = resolveOccurrenceInSubprocess("Europe/Berlin");
    expect(utc.exitCode).toBe(0);
    expect(berlin.exitCode).toBe(0);
    expect(utc.stderr).toBe("");
    expect(berlin.stderr).toBe("");
    expect(utc.stdout).toBe(String(Date.UTC(2025, 10, 11, 9, 45, 0)));
    expect(berlin.stdout).toBe(utc.stdout);
  });
});
