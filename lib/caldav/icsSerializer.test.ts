import { describe, expect, test } from "bun:test";
import type { CalendarEvent } from "@/lib/data";
import { patchIcsForEvent, parseIcsLastModified } from "./icsSerializer";

const BASE_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Test//EN",
  "BEGIN:VEVENT",
  "UID:evt-1@example.test",
  "DTSTAMP:20260101T090000Z",
  "LAST-MODIFIED:20260105T120000Z",
  "DTSTART:20260110T090000Z",
  "DTEND:20260110T093000Z",
  "SUMMARY:Weekly sync",
  "RRULE:FREQ=WEEKLY;BYDAY=MO",
  "ORGANIZER:mailto:boss@example.test",
  "ATTENDEE;CN=Me;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:me@example.test",
  "ATTENDEE;CN=Other;PARTSTAT=DECLINED:mailto:other@example.test",
  "SEQUENCE:3",
  "X-CUSTOM-PROP:keepme",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT15M",
  "END:VALARM",
  "END:VEVENT",
  "END:VCALENDAR"
].join("\r\n");

function buildEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const start = Date.UTC(2026, 0, 10, 9, 0, 0);
  return {
    id: "evt-row-1",
    accountId: "acc-1",
    eventUid: "evt-1@example.test",
    summary: "Weekly sync",
    startAtMs: start,
    endAtMs: start + 30 * 60 * 1000,
    allDay: false,
    recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
    sourceType: "caldav",
    createdAtMs: start,
    updatedAtMs: start,
    ...overrides
  };
}

function lineFor(ics: string, needle: string): string | undefined {
  return ics.split(/\r\n|\n/).find((l) => l.includes(needle));
}

describe("patchIcsForEvent", () => {
  test("adds EXDATE while preserving VALARM and X-props", () => {
    const event = buildEvent({ excludedDates: [Date.UTC(2026, 0, 17, 9, 0, 0)] });
    const out = patchIcsForEvent(BASE_ICS, event);
    expect(out).toContain("EXDATE:");
    expect(out).toContain("BEGIN:VALARM");
    expect(out).toContain("TRIGGER:-PT15M");
    expect(out).toContain("X-CUSTOM-PROP:keepme");
  });

  test("replaces RRULE on truncation", () => {
    const event = buildEvent({ recurrenceRule: "FREQ=WEEKLY;BYDAY=MO;UNTIL=20260201T090000Z" });
    const out = patchIcsForEvent(BASE_ICS, event);
    expect(out).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260201T090000Z");
    expect(out).not.toContain("RRULE:FREQ=WEEKLY;BYDAY=MO\r");
  });

  test("updates SUMMARY/DTSTART and bumps SEQUENCE on an edit", () => {
    const event = buildEvent({
      summary: "Weekly sync (moved)",
      startAtMs: Date.UTC(2026, 0, 10, 10, 0, 0)
    });
    const out = patchIcsForEvent(BASE_ICS, event);
    expect(out).toContain("SUMMARY:Weekly sync (moved)");
    expect(out).toContain("DTSTART:20260110T100000Z");
    expect(out).toContain("SEQUENCE:4");
    expect(out).not.toContain("SEQUENCE:3");
  });

  test("sets PARTSTAT on the user's attendee only", () => {
    const event = buildEvent({ myAttendeeEmail: "me@example.test", myPartstat: "ACCEPTED" });
    const out = patchIcsForEvent(BASE_ICS, event);
    expect(lineFor(out, "me@example.test")).toContain("PARTSTAT=ACCEPTED");
    expect(lineFor(out, "other@example.test")).toContain("PARTSTAT=DECLINED");
  });

  test("matches the attendee address exactly, not as a substring", () => {
    const icsSub = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:evt-2@example.test",
      "DTSTART:20260110T090000Z",
      "SUMMARY:Sub",
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:team-a@example.test",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");
    // "a@example.test" is a substring of "team-a@example.test" — the old
    // includes() check would have wrongly stamped this attendee.
    const event = buildEvent({
      eventUid: "evt-2@example.test",
      myAttendeeEmail: "a@example.test",
      myPartstat: "ACCEPTED"
    });
    const out = patchIcsForEvent(icsSub, event);
    expect(lineFor(out, "team-a@example.test")).toContain("PARTSTAT=NEEDS-ACTION");
    expect(out).not.toContain("PARTSTAT=ACCEPTED");
  });

  test("refreshes LAST-MODIFIED / DTSTAMP", () => {
    const out = patchIcsForEvent(BASE_ICS, buildEvent());
    expect(out).not.toContain("LAST-MODIFIED:20260105T120000Z");
    expect(out).not.toContain("DTSTAMP:20260101T090000Z");
    expect(out).toContain("LAST-MODIFIED:");
  });

  test("falls back to full serialization when no rawIcs exists", () => {
    const out = patchIcsForEvent(undefined, buildEvent());
    expect(out).toContain("BEGIN:VCALENDAR");
    expect(out).toContain("UID:evt-1@example.test");
  });
});

describe("parseIcsLastModified", () => {
  test("reads LAST-MODIFIED in preference to DTSTAMP", () => {
    expect(parseIcsLastModified(BASE_ICS)).toBe(Date.UTC(2026, 0, 5, 12, 0, 0));
  });

  test("falls back to DTSTAMP when LAST-MODIFIED is absent", () => {
    const ics = BASE_ICS.replace("LAST-MODIFIED:20260105T120000Z\r\n", "");
    expect(parseIcsLastModified(ics)).toBe(Date.UTC(2026, 0, 1, 9, 0, 0));
  });
});
