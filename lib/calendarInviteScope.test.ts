import { describe, expect, test } from "bun:test";
import { parseIcsInvite } from "./calendar";
import { collectCalendarInviteMutationGroups } from "./calendarInviteProcessing";
import { getCalendarInviteScopeInfo } from "./calendarInviteScope";

function makeIcs(lines: string[]) {
  return ["BEGIN:VCALENDAR", ...lines, "END:VCALENDAR"].join("\r\n");
}

function firstEventScopeLabel(ics: string) {
  const parsed = parseIcsInvite(ics);
  const event = parsed.events[0]!;
  const group = collectCalendarInviteMutationGroups(ics)[0];
  return getCalendarInviteScopeInfo({ event, mutationGroup: group }).label;
}

describe("getCalendarInviteScopeInfo", () => {
  test("labels non-recurring invites as a single event", () => {
    const ics = makeIcs([
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:single@example.test",
      "DTSTART:20260608T100000Z",
      "DTEND:20260608T103000Z",
      "END:VEVENT"
    ]);

    expect(firstEventScopeLabel(ics)).toBe("Single event");
  });

  test("labels recurring base events as a series", () => {
    const ics = makeIcs([
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:series@example.test",
      "DTSTART:20260608T100000Z",
      "DTEND:20260608T103000Z",
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "END:VEVENT"
    ]);

    expect(firstEventScopeLabel(ics)).toBe("Series");
  });

  test("labels one recurrence-id event as one occurrence", () => {
    const ics = makeIcs([
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:series@example.test",
      "RECURRENCE-ID:20260608T100000Z",
      "DTSTART:20260608T110000Z",
      "DTEND:20260608T113000Z",
      "END:VEVENT"
    ]);

    expect(firstEventScopeLabel(ics)).toBe("One occurrence");
  });

  test("labels multiple recurrence-id events as multiple occurrences", () => {
    const ics = makeIcs([
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:series@example.test",
      "RECURRENCE-ID:20260608T100000Z",
      "DTSTART:20260608T110000Z",
      "DTEND:20260608T113000Z",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:series@example.test",
      "RECURRENCE-ID:20260615T100000Z",
      "DTSTART:20260615T110000Z",
      "DTEND:20260615T113000Z",
      "END:VEVENT"
    ]);

    expect(firstEventScopeLabel(ics)).toBe("Multiple occurrences");
  });

  test("labels this-and-future recurrence changes as multiple occurrences", () => {
    const ics = makeIcs([
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:series@example.test",
      "RECURRENCE-ID;RANGE=THISANDFUTURE:20260608T100000Z",
      "DTSTART:20260608T110000Z",
      "DTEND:20260608T113000Z",
      "END:VEVENT"
    ]);

    const parsed = parseIcsInvite(ics);
    expect(parsed.events[0]?.recurrenceIdRange).toBe("THISANDFUTURE");
    expect(firstEventScopeLabel(ics)).toBe("Multiple occurrences");
  });

  test("uses the stored event recurrence when an invite has no recurrence fields", () => {
    const ics = makeIcs([
      "METHOD:CANCEL",
      "BEGIN:VEVENT",
      "UID:series@example.test",
      "DTSTART:20260608T100000Z",
      "DTEND:20260608T103000Z",
      "STATUS:CANCELLED",
      "END:VEVENT"
    ]);
    const event = parseIcsInvite(ics).events[0]!;

    expect(
      getCalendarInviteScopeInfo({
        event,
        mutationGroup: collectCalendarInviteMutationGroups(ics)[0],
        storedEvent: { recurrenceRule: "FREQ=WEEKLY" }
      }).label
    ).toBe("Series");
  });
});
