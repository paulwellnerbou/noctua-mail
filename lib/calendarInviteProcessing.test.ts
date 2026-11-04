import { describe, expect, test } from "bun:test";
import {
  collectCalendarInviteMutationGroups,
  inferCalendarInviteActionType,
  inferCalendarInviteMessageActionType
} from "./calendarInviteProcessing";

function makeIcs(lines: string[]) {
  return ["BEGIN:VCALENDAR", ...lines, "END:VCALENDAR"].join("\r\n");
}

describe("calendar invite action typing", () => {
  test("treats instance cancellation as a cancellation for message UI but update for processing", () => {
    const ics = makeIcs([
      "METHOD:CANCEL",
      "BEGIN:VEVENT",
      "UID:series-uid@example.test",
      "RECURRENCE-ID:20260608T100000Z",
      "DTSTART:20260608T100000Z",
      "DTEND:20260608T103000Z",
      "STATUS:CANCELLED",
      "SEQUENCE:7",
      "END:VEVENT"
    ]);

    const [group] = collectCalendarInviteMutationGroups(ics);
    expect(group?.hasCancellation).toBe(true);
    expect(inferCalendarInviteMessageActionType(group!)).toBe("cancellation");
    expect(inferCalendarInviteActionType(group!, { hasExistingEvent: true })).toBe("update");
  });
});

describe("collectCalendarInviteMutationGroups", () => {
  test("keeps a published appointment whose VEVENT carries no UID", () => {
    const ics = makeIcs([
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "SUMMARY:Dental check-up",
      "DTSTART:20260305T083000",
      "DTEND:20260305T093000",
      "END:VEVENT"
    ]);

    const groups = collectCalendarInviteMutationGroups(ics);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.eventUid).toMatch(/^noctua-derived-/);
    expect(groups[0]?.baseEvent?.summary).toBe("Dental check-up");
    expect(inferCalendarInviteMessageActionType(groups[0]!)).toBe("invitation");
  });
});

describe("collectCalendarInviteMutationGroups default time zone", () => {
  test("resolves floating times in the given zone", () => {
    const ics = makeIcs([
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:floating@example.test",
      "SUMMARY:Dental check-up",
      "DTSTART:20261105T083000",
      "DTEND:20261105T093000",
      "END:VEVENT"
    ]);

    const [group] = collectCalendarInviteMutationGroups(ics, { defaultTimeZone: "Europe/Berlin" });
    expect(group?.baseEvent?.start?.toISOString()).toBe("2026-11-05T07:30:00.000Z");
    expect(group?.baseEvent?.end?.toISOString()).toBe("2026-11-05T08:30:00.000Z");
    expect(group?.baseEvent?.startTimezone).toBe("Europe/Berlin");
  });
});
