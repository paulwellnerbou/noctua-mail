import { describe, expect, test } from "bun:test";
import { buildCalendarReplyPayload } from "./calendarReply";
import type { Account, CalendarEvent } from "./data";

function buildAccount(): Account {
  return {
    id: "acc-1",
    name: "Paul",
    email: "paul@example.test",
    settings: {},
    imap: { host: "imap.example.test", port: 993, secure: true, user: "paul", password: "pw" },
    smtp: { host: "smtp.example.test", port: 465, secure: true, user: "paul", password: "pw" }
  };
}

function buildEvent(): CalendarEvent {
  const rawIcs = [
    "BEGIN:VCALENDAR",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:event-1@example.test",
    "SUMMARY:Team Meeting",
    "DTSTART:20260601T100000Z",
    "ORGANIZER;CN=Alice:mailto:alice@example.test",
    "ATTENDEE;CN=Paul;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:paul@example.test",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

  return {
    id: "cal-1",
    accountId: "acc-1",
    eventUid: "event-1@example.test",
    summary: "Team Meeting",
    startAtMs: Date.UTC(2026, 5, 1, 10, 0, 0),
    allDay: false,
    sourceType: "email",
    rawIcs,
    myAttendeeEmail: "paul@example.test",
    createdAtMs: 1,
    updatedAtMs: 1
  };
}

describe("calendar reply payload", () => {
  test("builds a reply email and ICS attachment payload", () => {
    const payload = buildCalendarReplyPayload(buildAccount(), buildEvent(), "ACCEPTED");

    expect(payload.to).toBe("alice@example.test");
    expect(payload.subject).toContain("Accepted");
    expect(payload.attendeeEmail).toBe("paul@example.test");
    expect(payload.ics).toContain("METHOD:REPLY");
    expect(payload.ics).toContain("PARTSTAT=ACCEPTED");
    expect(payload.ics).toContain("UID:event-1@example.test");
  });

  test("builds an occurrence-scoped reply with recurrence id", () => {
    const occurrenceStartAtMs = Date.UTC(2026, 5, 15, 10, 0, 0);
    const payload = buildCalendarReplyPayload(buildAccount(), buildEvent(), "DECLINED", {
      scope: "occurrence",
      occurrenceStartAtMs
    });

    expect(payload.ics).toContain("PARTSTAT=DECLINED");
    expect(payload.ics).toContain("DTSTART:20260615T100000Z");
    expect(payload.ics).toContain("RECURRENCE-ID:20260615T100000Z");
  });
});
