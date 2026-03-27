import { describe, expect, it } from "bun:test";
import type { Account } from "@/lib/data";
import type { ComposeInvitePayload } from "@/lib/composeInvite";
import { normalizeCalendarIcsLineEndings } from "@/lib/calendarIcs";
import { buildSentInvite } from "./sentInvite";

function buildAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    name: "Owner Example",
    email: "owner@example.test",
    avatar: "",
    imap: {
      host: "imap.example.test",
      port: 993,
      secure: true,
      user: "owner@example.test",
      password: "secret-imap"
    },
    smtp: {
      host: "smtp.example.test",
      port: 465,
      secure: true,
      user: "owner@example.test",
      password: "secret-smtp"
    },
    ...overrides
  };
}

function buildInvite(overrides: Partial<ComposeInvitePayload> = {}): ComposeInvitePayload {
  return {
    location: "Room 2",
    startAtMs: Date.UTC(2026, 2, 26, 9, 0, 0),
    endAtMs: Date.UTC(2026, 2, 26, 10, 0, 0),
    allDay: false,
    recurrenceRule: "FREQ=WEEKLY",
    ...overrides
  };
}

describe("buildSentInvite", () => {
  it("builds REQUEST ICS plus a sent-invite calendar event", () => {
    const result = buildSentInvite({
      account: buildAccount(),
      invite: buildInvite(),
      subject: "Planning session",
      to: "Alice <alice@example.test>, owner@example.test",
      cc: "Bob <bob@example.test>",
      descriptionText: "Line one\nLine two"
    });
    const unfoldedIcs = normalizeCalendarIcsLineEndings(result.ics).replace(/\n[ \t]/g, "");

    expect(result.filename).toBe("Planning session.ics");
    expect(unfoldedIcs).toContain("BEGIN:VCALENDAR");
    expect(unfoldedIcs).toContain("METHOD:REQUEST");
    expect(unfoldedIcs).toContain("SUMMARY:Planning session");
    expect(unfoldedIcs).toContain("DESCRIPTION:Line one\\nLine two");
    expect(unfoldedIcs).toContain("LOCATION:Room 2");
    expect(unfoldedIcs).toContain("RRULE:FREQ=WEEKLY");
    expect(unfoldedIcs).toContain(
      "ORGANIZER;CN=Owner Example:mailto:owner@example.test"
    );
    expect(unfoldedIcs).toContain(
      "ATTENDEE;CN=Alice;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:alice@example.test"
    );
    expect(unfoldedIcs).toContain(
      "ATTENDEE;CN=Bob;ROLE=OPT-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:bob@example.test"
    );
    expect(unfoldedIcs).toContain(
      "ATTENDEE;CN=owner@example.test;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:owner@example.test"
    );

    expect(result.event.sourceType).toBe("sent-invite");
    expect(result.event.summary).toBe("Planning session");
    expect(result.event.description).toBe("Line one\nLine two");
    expect(result.event.location).toBe("Room 2");
    expect(result.event.recurrenceRule).toBe("FREQ=WEEKLY");
    expect(result.event.organizer).toBe("Owner Example <owner@example.test>");
    expect(result.event.attendees).toContain("alice@example.test");
    expect(result.event.attendees).toContain("bob@example.test");
    expect(result.event.attendees).toContain("owner@example.test");
    expect(result.event.myAttendeeEmail).toBe("owner@example.test");
    expect(result.event.myPartstat).toBe("ACCEPTED");
    expect(result.event.replyRequested).toBe(true);
    expect(result.event.rawIcs).toBe(result.ics);
    expect(result.event.eventUid).toContain("@example.test");
  });

  it("builds a self-only invite that is immediately accepted locally", () => {
    const result = buildSentInvite({
      account: buildAccount(),
      invite: buildInvite({ recurrenceRule: undefined }),
      subject: "Solo block",
      to: "Owner Example <owner@example.test>",
      descriptionText: "Personal event"
    });
    const unfoldedIcs = normalizeCalendarIcsLineEndings(result.ics).replace(/\n[ \t]/g, "");

    expect(unfoldedIcs).toContain(
      "ATTENDEE;CN=Owner Example;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:owner@example.test"
    );
    expect(result.event.myAttendeeEmail).toBe("owner@example.test");
    expect(result.event.myPartstat).toBe("ACCEPTED");
    expect(result.event.replyRequested).toBe(false);
  });
});
