import { describe, expect, test } from "bun:test";
import {
  buildCalendarRecurrenceSummary,
  formatCalendarEventDate,
  formatCalendarEventRange,
  parseIcsEvents
} from "./calendar";

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

  test("formats the until date through the account dateFormat, not rrule's English text", () => {
    const summary = buildCalendarRecurrenceSummary(
      {
        allDay: false,
        start: new Date("2026-03-11T10:00:00.000Z"),
        startTimezone: "Europe/Berlin",
        recurrenceRule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;UNTIL=20260506T133000Z"
      },
      "dmy"
    );
    // en-GB (dmy) renders day before month; we explicitly do not want
    // rrule.js's "May 6, 2026" en-US text to leak through.
    expect(summary).toMatch(/until\s+6\s+May\s+2026/);
    expect(summary).not.toMatch(/until\s+May\s+6/);
  });

  test("starting date also follows the account dateFormat", () => {
    const summary = buildCalendarRecurrenceSummary(
      {
        allDay: false,
        start: new Date("2026-03-11T10:00:00.000Z"),
        startTimezone: "Europe/Berlin",
        recurrenceRule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;UNTIL=20260506T133000Z"
      },
      "dmy"
    );
    expect(summary).toMatch(/starting\s+11\s+Mar/);
  });

  test("ymd renders true YYYY-MM-DD, not a short-month locale fallback", () => {
    const summary = buildCalendarRecurrenceSummary(
      {
        allDay: false,
        start: new Date("2026-03-11T10:00:00.000Z"),
        startTimezone: "Europe/Berlin",
        recurrenceRule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=WE;UNTIL=20260506T133000Z"
      },
      "ymd"
    );
    expect(summary).toMatch(/starting\s+2026-03-11/);
    expect(summary).toMatch(/until\s+2026-05-06/);
    expect(summary).not.toMatch(/Mar 11/);
  });
});

describe("formatCalendarEventRange ymd", () => {
  test("emits YYYY-MM-DD with 24h time for ymd preset", () => {
    const start = new Date(Date.UTC(2026, 2, 11, 14, 30, 0));
    const end = new Date(Date.UTC(2026, 2, 11, 15, 15, 0));
    const range = formatCalendarEventRange(start, end, {
      startTimeZone: "Europe/Berlin",
      dateFormat: "ymd"
    });
    expect(range).toContain("2026-03-11");
    expect(range).toContain("15:30");
    expect(range).toContain("16:15");
    expect(range).not.toMatch(/Mar 11/);
  });

  test("resolves Windows timezone names like 'W. Europe Standard Time'", () => {
    const start = new Date(Date.UTC(2026, 2, 11, 14, 30, 0));
    const range = formatCalendarEventRange(start, undefined, {
      startTimeZone: "W. Europe Standard Time",
      dateFormat: "ymd"
    });
    expect(range).toContain("2026-03-11");
  });
});

describe("formatCalendarEventRange", () => {
  test("omits the repeated date when the event starts and ends on the same day", () => {
    const start = new Date(Date.UTC(2026, 3, 14, 15, 15, 0));
    const end = new Date(Date.UTC(2026, 3, 14, 15, 45, 0));

    const formattedStart = formatCalendarEventDate(start, { timeZone: "Europe/Berlin" });
    const formattedEnd = formatCalendarEventDate(end, { timeZone: "Europe/Berlin" });
    const endTimeOnly = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Europe/Berlin"
    }).format(end);

    expect(
      formatCalendarEventRange(start, end, { startTimeZone: "Europe/Berlin" })
    ).toBe(`${formattedStart} – ${endTimeOnly}`);
    expect(formattedEnd).not.toBe(endTimeOnly);
  });

  test("keeps the second date when the event spans multiple days", () => {
    const start = new Date(Date.UTC(2026, 3, 14, 15, 15, 0));
    const end = new Date(Date.UTC(2026, 3, 15, 15, 45, 0));

    const formattedStart = formatCalendarEventDate(start, { timeZone: "Europe/Berlin" });
    const formattedEnd = formatCalendarEventDate(end, { timeZone: "Europe/Berlin" });

    expect(
      formatCalendarEventRange(start, end, { startTimeZone: "Europe/Berlin" })
    ).toBe(`${formattedStart} – ${formattedEnd}`);
  });

  test("respects the account dateFormat preset (DD/MM vs MM/DD)", () => {
    const date = new Date(Date.UTC(2026, 2, 11, 14, 30, 0));
    const dmy = formatCalendarEventDate(date, { timeZone: "UTC", dateFormat: "dmy" });
    const mdy = formatCalendarEventDate(date, { timeZone: "UTC", dateFormat: "mdy" });
    // en-GB style puts day before month; en-US style puts month before day.
    // The exact short month/weekday formatting is locale-dependent, so we
    // assert the day-vs-month ordering rather than the full string.
    expect(dmy).toMatch(/\b11\b.*\b(March|Mar)\b/);
    expect(mdy).toMatch(/\b(March|Mar)\b.*\b11\b/);
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
