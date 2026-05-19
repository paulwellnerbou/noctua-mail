import { describe, expect, test } from "bun:test";
import { collectCalendarInviteMutationGroups } from "./calendarInviteProcessing";
import { deriveInviteDeckEventBounds } from "./inviteDeckEventBounds";

describe("deriveInviteDeckEventBounds", () => {
  test("captures finite recurring bounds from RRULE COUNT", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:demo-uid@example.test",
      "SUMMARY:Weekly standup",
      "DTSTART:20260401T100000Z",
      "DTEND:20260401T103000Z",
      "RRULE:FREQ=WEEKLY;COUNT=4",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const [group] = collectCalendarInviteMutationGroups(ics);
    const bounds = deriveInviteDeckEventBounds(group);
    expect(bounds.eventFirstStartAtMs).toBe(Date.UTC(2026, 3, 1, 10, 0, 0));
    expect(bounds.eventLastEndAtMs).toBe(Date.UTC(2026, 3, 22, 10, 30, 0));
  });

  test("keeps unbounded recurring series open-ended", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:demo-uid@example.test",
      "SUMMARY:Weekly standup",
      "DTSTART:20260401T100000Z",
      "DTEND:20260401T103000Z",
      "RRULE:FREQ=WEEKLY",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const [group] = collectCalendarInviteMutationGroups(ics);
    const bounds = deriveInviteDeckEventBounds(group);
    expect(bounds.eventFirstStartAtMs).toBe(Date.UTC(2026, 3, 1, 10, 0, 0));
    expect(bounds.eventLastEndAtMs).toBeNull();
  });

  test("captures finite recurring bounds from RRULE COUNT with a timezone", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:demo-uid@example.test",
      "SUMMARY:Weekly standup",
      "DTSTART;TZID=Europe/Berlin:20260401T100000",
      "DTEND;TZID=Europe/Berlin:20260401T103000",
      "RRULE:FREQ=WEEKLY;COUNT=4",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const [group] = collectCalendarInviteMutationGroups(ics);
    const bounds = deriveInviteDeckEventBounds(group);
    expect(bounds.eventFirstStartAtMs).toBe(Date.UTC(2026, 3, 1, 8, 0, 0));
    expect(bounds.eventLastEndAtMs).toBe(Date.UTC(2026, 3, 22, 8, 30, 0));
  });

  test("includes the final occurrence when RRULE UNTIL is in UTC and DTSTART timezone is in DST", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:demo-uid@example.test",
      "SUMMARY:Bi-weekly sync",
      "DTSTART;TZID=Europe/Berlin:20260311T153000",
      "DTEND;TZID=Europe/Berlin:20260311T161500",
      "RRULE:FREQ=WEEKLY;UNTIL=20260506T133000Z;INTERVAL=2;BYDAY=WE",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const [group] = collectCalendarInviteMutationGroups(ics);
    const bounds = deriveInviteDeckEventBounds(group);
    expect(bounds.eventFirstStartAtMs).toBe(Date.UTC(2026, 2, 11, 14, 30, 0));
    expect(bounds.eventLastEndAtMs).toBe(Date.UTC(2026, 4, 6, 14, 15, 0));
  });

  test("uses instance-only updates as finite occurrences", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:demo-uid@example.test",
      "RECURRENCE-ID:20260408T100000Z",
      "SUMMARY:Weekly standup (moved)",
      "DTSTART:20260408T130000Z",
      "DTEND:20260408T133000Z",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    const [group] = collectCalendarInviteMutationGroups(ics);
    const bounds = deriveInviteDeckEventBounds(group);
    expect(bounds.eventFirstStartAtMs).toBe(Date.UTC(2026, 3, 8, 13, 0, 0));
    expect(bounds.eventLastEndAtMs).toBe(Date.UTC(2026, 3, 8, 13, 30, 0));
  });
});
