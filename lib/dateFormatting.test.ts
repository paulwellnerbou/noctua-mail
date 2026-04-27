import { describe, expect, test } from "bun:test";
import {
  formatAccountDateValue,
  formatAccountMediumDate,
  formatAccountMediumDateTime,
  formatAccountShortTime,
  formatAccountTimestampLabel,
  formatAccountUpcomingDateLabel
} from "./dateFormatting";

// A stable timestamp (2026-04-15 15:45:00 local). We use getTime() from a
// locally-constructed Date so these assertions pass regardless of the CI
// machine's timezone.
const SAMPLE_MS = new Date(2026, 3, 15, 15, 45, 0).getTime();

function formatUpcomingDateLabelInSubprocess(timeZone: string) {
  const evalSource = `
    import { formatAccountUpcomingDateLabel } from "./lib/dateFormatting";
    const nowMs = new Date(2026, 2, 29, 9, 0, 0).getTime();
    const tomorrowMs = new Date(2026, 2, 30, 10, 0, 0).getTime();
    process.stdout.write(formatAccountUpcomingDateLabel(tomorrowMs, "ymd", nowMs) ?? "");
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

describe("dateFormatting helpers", () => {
  test("formatAccountDateValue honors ymd preset", () => {
    expect(formatAccountDateValue(SAMPLE_MS, "ymd")).toBe("2026-04-15 15:45");
  });

  test("formatAccountDateValue uses US numeric ordering for mdy", () => {
    const output = formatAccountDateValue(SAMPLE_MS, "mdy");
    // en-US numeric format places month first.
    expect(output).toMatch(/^4\/15\/2026/);
  });

  test("formatAccountDateValue uses day-first ordering for dmy", () => {
    const output = formatAccountDateValue(SAMPLE_MS, "dmy");
    expect(output).toMatch(/^15\/04\/2026/);
  });

  test("formatAccountMediumDateTime switches output when the user changes preset", () => {
    // This is the core consolidation guarantee: routing a call site through
    // lib/dateFormatting must react to the account's stored preference.
    const ymd = formatAccountMediumDateTime(SAMPLE_MS, "ymd");
    const mdy = formatAccountMediumDateTime(SAMPLE_MS, "mdy");
    const dmy = formatAccountMediumDateTime(SAMPLE_MS, "dmy");

    // All three outputs must be non-null.
    expect(ymd).not.toBeNull();
    expect(mdy).not.toBeNull();
    expect(dmy).not.toBeNull();

    // ymd is the unambiguous canary: it MUST contain the ISO date shape.
    expect(ymd).toContain("2026-04-15");

    // mdy and dmy must differ from each other (US vs UK ordering) to prove
    // the preset actually flows through.
    expect(mdy).not.toBe(dmy);
    expect(mdy).toContain("2026");
    expect(dmy).toContain("2026");
  });

  test("formatAccountMediumDate honors ymd preset without adding time", () => {
    expect(formatAccountMediumDate(SAMPLE_MS, "ymd")).toBe("2026-04-15");
  });

  test("formatAccountUpcomingDateLabel uses relative labels for today and tomorrow", () => {
    const nowMs = new Date(2026, 3, 15, 9, 0, 0).getTime();
    const todayMs = new Date(2026, 3, 15, 15, 45, 0).getTime();
    const tomorrowMs = new Date(2026, 3, 16, 10, 0, 0).getTime();

    expect(formatAccountUpcomingDateLabel(todayMs, "ymd", nowMs)).toBe("Today");
    expect(formatAccountUpcomingDateLabel(tomorrowMs, "ymd", nowMs)).toBe("Tomorrow");
  });

  test("formatAccountUpcomingDateLabel handles tomorrow across DST boundaries", () => {
    const result = formatUpcomingDateLabelInSubprocess("Europe/Berlin");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("Tomorrow");
  });

  test("formatAccountUpcomingDateLabel falls back to account-formatted dates", () => {
    const nowMs = new Date(2026, 3, 15, 9, 0, 0).getTime();
    const laterMs = new Date(2026, 3, 20, 10, 0, 0).getTime();

    expect(formatAccountUpcomingDateLabel(laterMs, "ymd", nowMs)).toBe("2026-04-20");
  });

  test("formatAccountShortTime returns a non-empty label", () => {
    const output = formatAccountShortTime(SAMPLE_MS, "locale");
    expect(output).not.toBeNull();
    expect(output!.length).toBeGreaterThan(0);
  });

  test("formatAccountShortTime with ymd preset returns only a time label", () => {
    const output = formatAccountShortTime(SAMPLE_MS, "ymd");
    expect(output).not.toBeNull();
    expect(output).toMatch(/^\d{2}:\d{2}$/);
    expect(output).not.toContain("-");
  });

  test("formatAccountTimestampLabel returns the fallback for null/invalid input", () => {
    expect(formatAccountTimestampLabel(null)).toBe("Never");
    expect(formatAccountTimestampLabel(undefined)).toBe("Never");
    expect(formatAccountTimestampLabel(Number.NaN)).toBe("Never");
    expect(formatAccountTimestampLabel(null, "locale", "Unknown")).toBe("Unknown");
  });

  test("formatAccountTimestampLabel delegates formatting to the preset", () => {
    expect(formatAccountTimestampLabel(SAMPLE_MS, "ymd")).toContain("2026-04-15");
  });

  test("formatAccountMediumDateTime returns null for non-finite input", () => {
    expect(formatAccountMediumDateTime(Number.NaN)).toBeNull();
  });
});
