import { describe, expect, test } from "bun:test";
import { buildDerivedCalendarEventUid, normalizeCalendarEventUidKey } from "./calendarEventUids";

describe("buildDerivedCalendarEventUid", () => {
  const base = {
    startValue: "20260305T083000",
    endValue: "20260305T093000",
    summary: "Dental check-up"
  };

  test("is deterministic and tolerant of case and whitespace in the summary", () => {
    const uid = buildDerivedCalendarEventUid(base);
    expect(uid).toMatch(/^noctua-derived-[0-9a-f]{14}$/);
    expect(buildDerivedCalendarEventUid({ ...base, summary: "  dental   CHECK-UP " })).toBe(uid);
    expect(buildDerivedCalendarEventUid({ ...base, startValue: "20260305t083000" })).toBe(uid);
  });

  test("differs by start, end, time zone and recurrence id", () => {
    const uid = buildDerivedCalendarEventUid(base);
    expect(buildDerivedCalendarEventUid({ ...base, startValue: "20260306T083000" })).not.toBe(uid);
    expect(buildDerivedCalendarEventUid({ ...base, endValue: undefined })).not.toBe(uid);
    expect(buildDerivedCalendarEventUid({ ...base, startTzid: "Europe/Berlin" })).not.toBe(uid);
    expect(
      buildDerivedCalendarEventUid({ ...base, recurrenceIdValue: "20260305T083000" })
    ).not.toBe(uid);
  });

  test("passes through uid-key normalization unchanged", () => {
    const uid = buildDerivedCalendarEventUid(base);
    expect(normalizeCalendarEventUidKey(uid)).toBe(uid);
  });
});
