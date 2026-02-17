import { describe, expect, test } from "bun:test";
import {
  formatCalendarTimeZoneShortLabel,
  resolveCalendarTimeZoneId
} from "./calendarTimezones";

describe("calendar timezone helpers", () => {
  test("resolves slash-prefixed timezone IDs", () => {
    expect(resolveCalendarTimeZoneId("/America/New_York")).toBe("America/New_York");
  });

  test("resolves vendor-prefixed timezone IDs to a valid IANA tail", () => {
    expect(resolveCalendarTimeZoneId("/mozilla.org/20070129_1/Europe/Berlin")).toBe(
      "Europe/Berlin"
    );
  });

  test("maps common Windows timezone IDs", () => {
    expect(resolveCalendarTimeZoneId("Pacific Standard Time")).toBe("America/Los_Angeles");
  });

  test("formats a short timezone label", () => {
    const label = formatCalendarTimeZoneShortLabel("UTC", new Date(Date.UTC(2026, 0, 1, 12, 0, 0)));
    expect(label).toMatch(/UTC|GMT/i);
  });
});
