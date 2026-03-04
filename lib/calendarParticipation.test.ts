import { describe, expect, test } from "bun:test";
import { mergeCalendarParticipation, resolveCalendarParticipationFromPreview } from "./calendarParticipation";

describe("calendar participation", () => {
  test("defaults matched attendee participation to NEEDS-ACTION", () => {
    const resolved = resolveCalendarParticipationFromPreview(
      {
        attendeeDetails: [
          {
            email: "paul@example.test",
            name: "Paul",
            rsvp: true
          }
        ]
      },
      "paul@example.test"
    );

    expect(resolved.myAttendeeEmail).toBe("paul@example.test");
    expect(resolved.myPartstat).toBe("NEEDS-ACTION");
    expect(resolved.replyRequested).toBe(true);
  });

  test("preserves local RSVP over inbound NEEDS-ACTION", () => {
    const merged = mergeCalendarParticipation(
      {
        attendees: undefined,
        myPartstat: "ACCEPTED",
        myPartstatUpdatedAtMs: 100,
        myAttendeeEmail: "paul@example.test",
        replyRequested: true
      },
      {
        myAttendeeEmail: "paul@example.test",
        myPartstat: "NEEDS-ACTION",
        replyRequested: true
      },
      200
    );

    expect(merged.myPartstat).toBe("ACCEPTED");
    expect(merged.myPartstatUpdatedAtMs).toBe(100);
  });
});
