import { describe, expect, it } from "bun:test";
import { extractCalendarIcsMethod, extractCalendarIcsUid } from "./calendarIcs";

function buildIcs(lines: string[]) {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].join("\r\n");
}

describe("extractCalendarIcsMethod", () => {
  it("reads the top-level METHOD property", () => {
    const ics = buildIcs(["METHOD:REQUEST", "BEGIN:VEVENT", "UID:evt-1", "END:VEVENT"]);
    expect(extractCalendarIcsMethod(ics)).toBe("REQUEST");
  });

  it("uppercases the value and ignores property parameters", () => {
    expect(extractCalendarIcsMethod(buildIcs(["method:cancel"]))).toBe("CANCEL");
    expect(extractCalendarIcsMethod(buildIcs(["METHOD;X-FOO=bar:reply"]))).toBe("REPLY");
  });

  it("unfolds continuation lines", () => {
    expect(extractCalendarIcsMethod(buildIcs(["METHOD:REQ", " UEST"]))).toBe("REQUEST");
  });

  it("returns an empty string when no METHOD line exists", () => {
    expect(extractCalendarIcsMethod(buildIcs(["BEGIN:VEVENT", "UID:evt-1", "END:VEVENT"]))).toBe("");
    expect(extractCalendarIcsMethod("")).toBe("");
  });

  it("ignores METHOD lines nested inside components", () => {
    const ics = buildIcs(["BEGIN:VEVENT", "METHOD:REQUEST", "UID:evt-1", "END:VEVENT"]);
    expect(extractCalendarIcsMethod(ics)).toBe("");
  });

  it("rejects values outside the iTIP method list", () => {
    expect(extractCalendarIcsMethod(buildIcs(["METHOD:X-CUSTOM"]))).toBe("");
    expect(extractCalendarIcsMethod(buildIcs(["METHOD:REQUEST; evil=1"]))).toBe("");
  });
});

describe("extractCalendarIcsUid", () => {
  it("reads a plain UID", () => {
    expect(extractCalendarIcsUid(buildIcs(["BEGIN:VEVENT", "UID:evt-1", "END:VEVENT"]))).toBe(
      "evt-1"
    );
  });

  it("reads a UID with parameters and folded continuation", () => {
    const ics = buildIcs(["BEGIN:VEVENT", "UID;X-FOO=bar:evt-", " folded", "END:VEVENT"]);
    expect(extractCalendarIcsUid(ics)).toBe("evt-folded");
  });

  it("returns an empty string when no UID exists", () => {
    expect(extractCalendarIcsUid(buildIcs(["METHOD:REQUEST"]))).toBe("");
  });
});
