import { describe, test, expect } from "bun:test";
import { resolveEventMessageRelations, type MessageCandidate } from "./calendarEventRelations";

function makeIcs(lines: string[]) {
  return ["BEGIN:VCALENDAR", ...lines, "END:VCALENDAR"].join("\r\n");
}

const BASE_REQUEST = makeIcs([
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "UID:series-uid@test",
  "DTSTART:20240730T104500Z",
  "DTEND:20240730T110000Z",
  "SUMMARY:Weekly Sync",
  "RRULE:FREQ=WEEKLY;BYDAY=TU",
  "SEQUENCE:0",
  "END:VEVENT"
]);

const UPDATED_REQUEST = makeIcs([
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "UID:series-uid@test",
  "DTSTART:20240730T104500Z",
  "DTEND:20240730T110000Z",
  "SUMMARY:Weekly Sync (updated)",
  "RRULE:FREQ=WEEKLY;BYDAY=TU",
  "SEQUENCE:1",
  "END:VEVENT"
]);

// Cancels the occurrence on 2024-08-06 (RECURRENCE-ID)
const OCCURRENCE_CANCEL = makeIcs([
  "METHOD:CANCEL",
  "BEGIN:VEVENT",
  "UID:series-uid@test",
  "RECURRENCE-ID:20240806T104500Z",
  "DTSTART:20240806T104500Z",
  "STATUS:CANCELLED",
  "SEQUENCE:1",
  "END:VEVENT"
]);

// Reschedules the occurrence on 2024-08-13 to 2024-08-14
const OCCURRENCE_RESCHEDULE = makeIcs([
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "UID:series-uid@test",
  "RECURRENCE-ID:20240813T104500Z",
  "DTSTART:20240814T104500Z",
  "DTEND:20240814T110000Z",
  "SUMMARY:Weekly Sync (moved)",
  "SEQUENCE:2",
  "END:VEVENT"
]);

const AUG6_MS = new Date("2024-08-06T10:45:00Z").getTime();
const AUG13_MS = new Date("2024-08-13T10:45:00Z").getTime();
const AUG14_MS = new Date("2024-08-14T10:45:00Z").getTime();

describe("resolveEventMessageRelations", () => {
  test("single REQUEST with base event → returns that messageId", () => {
    const candidates: MessageCandidate[] = [
      { messageId: "msg-1", icsSource: BASE_REQUEST, dateValue: 1000 }
    ];
    const result = resolveEventMessageRelations(candidates);
    expect(result.seriesMessageId).toBe("msg-1");
    expect(result.occurrenceMessageIds).toEqual({});
  });

  test("multiple REQUESTs with base event → returns most recent by dateValue", () => {
    const candidates: MessageCandidate[] = [
      { messageId: "msg-old", icsSource: BASE_REQUEST, dateValue: 1000 },
      { messageId: "msg-new", icsSource: UPDATED_REQUEST, dateValue: 2000 }
    ];
    const result = resolveEventMessageRelations(candidates);
    expect(result.seriesMessageId).toBe("msg-new");
    expect(result.occurrenceMessageIds).toEqual({});
  });

  test("series REQUEST + occurrence CANCEL → series messageId from REQUEST, no occurrence link (cancelled occurrences are hidden)", () => {
    const candidates: MessageCandidate[] = [
      { messageId: "msg-base", icsSource: BASE_REQUEST, dateValue: 1000 },
      { messageId: "msg-cancel", icsSource: OCCURRENCE_CANCEL, dateValue: 2000 }
    ];
    const result = resolveEventMessageRelations(candidates);
    expect(result.seriesMessageId).toBe("msg-base");
    // Cancelled occurrences don't appear in the calendar, so no occurrence link
    expect(result.occurrenceMessageIds).toEqual({});
  });

  test("series REQUEST + occurrence reschedule → series from REQUEST, occurrence link for new start time", () => {
    const candidates: MessageCandidate[] = [
      { messageId: "msg-base", icsSource: BASE_REQUEST, dateValue: 1000 },
      { messageId: "msg-reschedule", icsSource: OCCURRENCE_RESCHEDULE, dateValue: 2000 }
    ];
    const result = resolveEventMessageRelations(candidates);
    expect(result.seriesMessageId).toBe("msg-base");
    // Rescheduled occurrence appears in calendar at the new start time (AUG14)
    expect(result.occurrenceMessageIds[String(AUG14_MS)]).toBe("msg-reschedule");
    // Original time (AUG13) should not be a key (it's excluded, not visible)
    expect(result.occurrenceMessageIds[String(AUG13_MS)]).toBeUndefined();
  });

  test("only occurrence-level updates, no base event → seriesMessageId is null", () => {
    const candidates: MessageCandidate[] = [
      { messageId: "msg-cancel", icsSource: OCCURRENCE_CANCEL, dateValue: 2000 },
      { messageId: "msg-reschedule", icsSource: OCCURRENCE_RESCHEDULE, dateValue: 3000 }
    ];
    const result = resolveEventMessageRelations(candidates);
    expect(result.seriesMessageId).toBeNull();
    expect(result.occurrenceMessageIds[String(AUG14_MS)]).toBe("msg-reschedule");
  });

  test("multiple occurrence updates for same occurrence → most recent wins", () => {
    const reschedule1 = makeIcs([
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:series-uid@test",
      "RECURRENCE-ID:20240813T104500Z",
      "DTSTART:20240814T104500Z",
      "DTEND:20240814T110000Z",
      "SEQUENCE:2",
      "END:VEVENT"
    ]);
    const reschedule2 = makeIcs([
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:series-uid@test",
      "RECURRENCE-ID:20240813T104500Z",
      "DTSTART:20240814T104500Z",
      "DTEND:20240814T120000Z",
      "SEQUENCE:3",
      "END:VEVENT"
    ]);
    const candidates: MessageCandidate[] = [
      { messageId: "msg-reschedule-1", icsSource: reschedule1, dateValue: 2000 },
      { messageId: "msg-reschedule-2", icsSource: reschedule2, dateValue: 3000 }
    ];
    const result = resolveEventMessageRelations(candidates);
    expect(result.occurrenceMessageIds[String(AUG14_MS)]).toBe("msg-reschedule-2");
  });

  test("empty candidates → null series, empty occurrences", () => {
    const result = resolveEventMessageRelations([]);
    expect(result.seriesMessageId).toBeNull();
    expect(result.occurrenceMessageIds).toEqual({});
  });

  test("cancelled-occurrence-only ICS does not produce an occurrence link", () => {
    const candidates: MessageCandidate[] = [
      { messageId: "msg-cancel", icsSource: OCCURRENCE_CANCEL, dateValue: 1000 }
    ];
    const result = resolveEventMessageRelations(candidates);
    expect(result.seriesMessageId).toBeNull();
    // AUG6 was cancelled, not rescheduled — should not appear as an occurrence link
    expect(result.occurrenceMessageIds[String(AUG6_MS)]).toBeUndefined();
    expect(Object.keys(result.occurrenceMessageIds)).toHaveLength(0);
  });
});
