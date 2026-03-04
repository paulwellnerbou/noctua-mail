import { describe, expect, test } from "bun:test";
import {
  extractEmailCalendarEventStatusFromIcs,
  resolveEmailCalendarEventStatus
} from "./calendarEventStatus";

describe("calendar event status", () => {
  test("normalizes ICS status values for stored email events", () => {
    expect(resolveEmailCalendarEventStatus("confirmed")).toBe("CONFIRMED");
    expect(resolveEmailCalendarEventStatus("  tentative  ")).toBe("TENTATIVE");
    expect(resolveEmailCalendarEventStatus("")).toBeUndefined();
    expect(resolveEmailCalendarEventStatus(undefined, "cancelled")).toBe("CANCELLED");
  });

  test("extracts the base event status for a UID from raw ICS", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:event-1@example.test",
      "DTSTART:20260601T100000Z",
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");

    expect(extractEmailCalendarEventStatusFromIcs(ics, "event-1@example.test")).toBe("CONFIRMED");
  });
});
