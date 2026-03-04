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
