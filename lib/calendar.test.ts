import { describe, expect, test } from "bun:test";
import { buildCalendarRecurrenceSummary, parseIcsEvents } from "./calendar";

function parseIcsEventInSubprocess(ics: string, timeZone: string) {
  const evalSource = `
    import { parseIcsEvents } from "./lib/calendar";
    const ics = ${JSON.stringify(ics)};
    const event = parseIcsEvents(ics)[0];
    process.stdout.write(JSON.stringify({
      startIso: event?.start?.toISOString(),
      startTimezone: event?.startTimezone,
      endIso: event?.end?.toISOString(),
      endTimezone: event?.endTimezone
    }));
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

describe("parseIcsEvents", () => {
  test("applies standalone VEVENT TZID to floating date-times", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:standalone-tzid@example.test",
      "DTSTART:20260330T073000",
      "DTEND:20260330T073000",
      "TZID:Europe/Berlin",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const [event] = parseIcsEvents(ics);
    expect(event?.start?.toISOString()).toBe("2026-03-30T05:30:00.000Z");
    expect(event?.end?.toISOString()).toBe("2026-03-30T05:30:00.000Z");
    expect(event?.startTimezone).toBe("Europe/Berlin");
    expect(event?.endTimezone).toBe("Europe/Berlin");
  });

  test("parses standalone VEVENT TZID consistently across process time zones", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:standalone-tzid@example.test",
      "DTSTART:20260330T073000",
      "DTEND:20260330T073000",
      "TZID:Europe/Berlin",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const utc = parseIcsEventInSubprocess(ics, "UTC");
    const berlin = parseIcsEventInSubprocess(ics, "Europe/Berlin");

    expect(utc.exitCode).toBe(0);
    expect(berlin.exitCode).toBe(0);
    expect(utc.stderr).toBe("");
    expect(berlin.stderr).toBe("");
    expect(utc.stdout).toBe(
      JSON.stringify({
        startIso: "2026-03-30T05:30:00.000Z",
        startTimezone: "Europe/Berlin",
        endIso: "2026-03-30T05:30:00.000Z",
        endTimezone: "Europe/Berlin"
      })
    );
    expect(berlin.stdout).toBe(utc.stdout);
  });
});
