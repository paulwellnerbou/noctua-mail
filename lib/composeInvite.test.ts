import { describe, expect, it } from "bun:test";
import {
  buildMonthlyByDayRRule,
  formatMonthlyByDayLabel,
  getEndValueAfterStartChange,
  parseLocalScheduleDate,
  recurrenceOptionLabel,
  recurrenceOptionToRRule,
  rruleToOption,
  shiftEndPreservingDuration
} from "./composeInvite";

describe("composeInvite", () => {
  it("moves the end datetime to start plus 30 minutes when the existing end is before start", () => {
    expect(
      getEndValueAfterStartChange("2026-03-26T13:00", "2026-03-26T12:00", false)
    ).toBe("2026-03-26T13:30");
  });

  it("keeps the end datetime when it is equal to or after the start datetime", () => {
    expect(
      getEndValueAfterStartChange("2026-03-26T13:00", "2026-03-26T13:00", false)
    ).toBe("2026-03-26T13:00");
    expect(
      getEndValueAfterStartChange("2026-03-26T13:00", "2026-03-26T14:00", false)
    ).toBe("2026-03-26T14:00");
  });

  it("clamps the end date to the start date for all-day events when the existing end is before start", () => {
    expect(getEndValueAfterStartChange("2026-03-27", "2026-03-26", true)).toBe(
      "2026-03-27"
    );
  });

  it("does not rewrite incomplete values", () => {
    expect(getEndValueAfterStartChange("", "2026-03-26T12:00", false)).toBe(
      "2026-03-26T12:00"
    );
    expect(getEndValueAfterStartChange("2026-03-26T13:00", "", false)).toBe("");
  });
});

describe("shiftEndPreservingDuration", () => {
  it("preserves a 1-hour duration when start moves forward", () => {
    expect(
      shiftEndPreservingDuration(
        "2026-03-26T10:00",
        "2026-03-26T13:00",
        "2026-03-26T11:00",
        false
      )
    ).toBe("2026-03-26T14:00");
  });

  it("preserves duration when start moves backward", () => {
    expect(
      shiftEndPreservingDuration(
        "2026-03-26T14:00",
        "2026-03-26T09:30",
        "2026-03-26T15:30",
        false
      )
    ).toBe("2026-03-26T11:00");
  });

  it("preserves a non-round duration (e.g. typed minutes)", () => {
    expect(
      shiftEndPreservingDuration(
        "2026-03-26T10:00",
        "2026-03-26T13:00",
        "2026-03-26T10:23",
        false
      )
    ).toBe("2026-03-26T13:23");
  });

  it("falls back to a 30-minute duration when prev end is at or before prev start", () => {
    expect(
      shiftEndPreservingDuration(
        "2026-03-26T10:00",
        "2026-03-26T13:00",
        "2026-03-26T10:00",
        false
      )
    ).toBe("2026-03-26T13:30");
  });

  it("preserves a multi-day span for all-day events", () => {
    expect(
      shiftEndPreservingDuration("2026-03-23", "2026-03-30", "2026-03-25", true)
    ).toBe("2026-04-01");
  });

  it("falls back to legacy behaviour when prev start is missing", () => {
    expect(
      shiftEndPreservingDuration("", "2026-03-26T13:00", "2026-03-26T12:00", false)
    ).toBe("2026-03-26T13:30");
  });

  it("returns prev end unchanged when next start is empty", () => {
    expect(
      shiftEndPreservingDuration(
        "2026-03-26T10:00",
        "",
        "2026-03-26T11:00",
        false
      )
    ).toBe("2026-03-26T11:00");
  });

  it("seeds end at start + fallback minutes when prev end is empty", () => {
    expect(
      shiftEndPreservingDuration("2026-03-26T10:00", "2026-03-26T13:00", "", false)
    ).toBe("2026-03-26T13:30");
  });

  it("seeds end at start + fallback minutes when prev end is empty (all-day)", () => {
    expect(
      shiftEndPreservingDuration("2026-03-26", "2026-03-30", "", true, 60)
    ).toBe("2026-03-30");
  });

  it("preserves wall-clock duration across a DST spring-forward span", () => {
    // EU spring-forward is Sun 2026-03-29 02:00 → 03:00. A wall-clock span
    // from Sat 28 10:00 to Sun 29 11:00 reads as 25 hours on the wall but is
    // 24 hours of real elapsed time in DST zones. Sliding the start to a
    // non-DST week must preserve the 25-hour wall-clock span.
    expect(
      shiftEndPreservingDuration(
        "2026-03-28T10:00",
        "2026-04-04T10:00",
        "2026-03-29T11:00",
        false
      )
    ).toBe("2026-04-05T11:00");
  });

  it("preserves wall-clock duration across a DST fall-back span", () => {
    // EU fall-back is Sun 2026-10-25 03:00 → 02:00. A span from Sat 24 10:00
    // to Sun 25 11:00 reads as 25 wall-clock hours but is 26 real-elapsed
    // hours. Sliding to a non-DST week must keep the 25-hour wall-clock span.
    expect(
      shiftEndPreservingDuration(
        "2026-10-24T10:00",
        "2026-11-07T10:00",
        "2026-10-25T11:00",
        false
      )
    ).toBe("2026-11-08T11:00");
  });
});

describe("monthly-by-day recurrence", () => {
  // 2026-03-17 is the third Tuesday of March 2026.
  it("derives the rrule from the start date's ordinal weekday", () => {
    const startDate = parseLocalScheduleDate("2026-03-17T09:00");
    expect(buildMonthlyByDayRRule(startDate)).toBe("FREQ=MONTHLY;BYDAY=3TU");
  });

  it("formats the human label from the start date", () => {
    const startDate = parseLocalScheduleDate("2026-03-17T09:00");
    expect(formatMonthlyByDayLabel(startDate)).toBe("Monthly on the third Tuesday");
  });

  it("maps the 5th occurrence to 'last' so the rule fires every month", () => {
    // 2026-03-30 is a Monday — the 5th and last Monday of March 2026.
    const startDate = parseLocalScheduleDate("2026-03-30");
    expect(buildMonthlyByDayRRule(startDate)).toBe("FREQ=MONTHLY;BYDAY=-1MO");
    expect(formatMonthlyByDayLabel(startDate)).toBe("Monthly on the last Monday");
  });

  it("falls back to a generic label and plain monthly rule when no date is given", () => {
    expect(formatMonthlyByDayLabel(null)).toBe("Monthly on weekday");
    expect(buildMonthlyByDayRRule(null)).toBe("FREQ=MONTHLY");
  });

  it("round-trips through rruleToOption / recurrenceOptionToRRule", () => {
    const startDate = parseLocalScheduleDate("2026-03-17T09:00");
    const rule = recurrenceOptionToRRule("monthly-by-day", startDate);
    expect(rruleToOption(rule)).toBe("monthly-by-day");
  });

  it("recognises -1<DAY> as the same preset (last weekday of month)", () => {
    expect(rruleToOption("FREQ=MONTHLY;BYDAY=-1FR")).toBe("monthly-by-day");
  });

  it("does not mistake plain monthly or BYDAY without ordinal as the preset", () => {
    expect(rruleToOption("FREQ=MONTHLY")).toBe("monthly");
    // BYDAY=TU (no ordinal) is allowed by RFC 5545 but isn't our preset shape.
    expect(rruleToOption("FREQ=MONTHLY;BYDAY=TU")).toBe("monthly");
  });

  it("uses dynamic label via recurrenceOptionLabel", () => {
    const startDate = parseLocalScheduleDate("2026-03-17");
    expect(recurrenceOptionLabel("monthly-by-day", startDate)).toBe(
      "Monthly on the third Tuesday"
    );
    expect(recurrenceOptionLabel("weekly", startDate)).toBe("Weekly");
  });

  it("uses 'last' when the start date is the 4th and last occurrence of its weekday", () => {
    // Feb 2026 has Thursdays on 5, 12, 19, 26 — only four. Feb 26 is the
    // 4th AND last Thursday. The 4th-Thursday rule would skip from Mar 26
    // to Apr 23; "last" stays on the latest Thursday each month.
    const startDate = parseLocalScheduleDate("2026-02-26");
    expect(buildMonthlyByDayRRule(startDate)).toBe("FREQ=MONTHLY;BYDAY=-1TH");
    expect(formatMonthlyByDayLabel(startDate)).toBe("Monthly on the last Thursday");
  });

  it("keeps 'fourth' when a 5th occurrence exists in the same month", () => {
    // Mar 2026 has 5 Tuesdays (3, 10, 17, 24, 31). Mar 24 is the 4th but
    // NOT the last — there is a 31. So we emit "fourth", not "last".
    const startDate = parseLocalScheduleDate("2026-03-24");
    expect(buildMonthlyByDayRRule(startDate)).toBe("FREQ=MONTHLY;BYDAY=4TU");
    expect(formatMonthlyByDayLabel(startDate)).toBe("Monthly on the fourth Tuesday");
  });
});
