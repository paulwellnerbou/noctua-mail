import { describe, expect, test } from "bun:test";
import type { CalendarEvent } from "./data";
import { capRecurrenceRuleAtUtcMs, pruneOccurrencesPastCap } from "./calendarSeriesReanchor";

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-1",
    accountId: "acc-1",
    eventUid: "uid@example.test",
    summary: "Series",
    startAtMs: Date.UTC(2026, 0, 1),
    allDay: false,
    sourceType: "email",
    createdAtMs: 1,
    updatedAtMs: 1,
    ...overrides
  };
}

describe("capRecurrenceRuleAtUtcMs", () => {
  const aprilSecondEndOfDayUtcMs = Date.UTC(2026, 3, 2, 23, 59, 59);

  test("injects UNTIL into a rule that has none", () => {
    const result = capRecurrenceRuleAtUtcMs(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR",
      aprilSecondEndOfDayUtcMs
    );
    expect(result).toEqual({
      changed: true,
      rule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;UNTIL=20260402T235959Z"
    });
  });

  test("preserves an RRULE: prefix and adds UNTIL", () => {
    const result = capRecurrenceRuleAtUtcMs(
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      aprilSecondEndOfDayUtcMs
    );
    expect(result).toEqual({
      changed: true,
      rule: "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260402T235959Z"
    });
  });

  test("lowers an existing UNTIL that is later than the cap", () => {
    const result = capRecurrenceRuleAtUtcMs(
      "FREQ=WEEKLY;UNTIL=20260701T235959Z;BYDAY=FR",
      aprilSecondEndOfDayUtcMs
    );
    expect(result).toEqual({
      changed: true,
      rule: "FREQ=WEEKLY;UNTIL=20260402T235959Z;BYDAY=FR"
    });
  });

  test("leaves an existing UNTIL that is already earlier than the cap", () => {
    const earlierCappedRule = "FREQ=WEEKLY;UNTIL=20260101T000000Z;BYDAY=FR";
    const result = capRecurrenceRuleAtUtcMs(earlierCappedRule, aprilSecondEndOfDayUtcMs);
    expect(result).toEqual({ changed: false, reason: "already-capped-earlier" });
  });

  test("skips rules that use COUNT (mutually exclusive with UNTIL)", () => {
    const result = capRecurrenceRuleAtUtcMs(
      "FREQ=WEEKLY;COUNT=10;BYDAY=FR",
      aprilSecondEndOfDayUtcMs
    );
    expect(result).toEqual({ changed: false, reason: "count-exclusive" });
  });

  test("returns no-rule for empty / nullish inputs", () => {
    expect(capRecurrenceRuleAtUtcMs(undefined, aprilSecondEndOfDayUtcMs)).toEqual({
      changed: false,
      reason: "no-rule"
    });
    expect(capRecurrenceRuleAtUtcMs("", aprilSecondEndOfDayUtcMs)).toEqual({
      changed: false,
      reason: "no-rule"
    });
    expect(capRecurrenceRuleAtUtcMs("   ", aprilSecondEndOfDayUtcMs)).toEqual({
      changed: false,
      reason: "no-rule"
    });
  });

  test("returns no-rule when the cap timestamp is not a valid positive number", () => {
    expect(capRecurrenceRuleAtUtcMs("FREQ=WEEKLY", 0)).toEqual({
      changed: false,
      reason: "no-rule"
    });
    expect(capRecurrenceRuleAtUtcMs("FREQ=WEEKLY", Number.NaN)).toEqual({
      changed: false,
      reason: "no-rule"
    });
  });
});

describe("pruneOccurrencesPastCap", () => {
  const capMs = Date.UTC(2026, 3, 3, 0, 0, 0); // 2026-04-03

  test("returns all-undefined when the event has no occurrence overrides", () => {
    expect(pruneOccurrencesPastCap(makeEvent(), capMs)).toEqual({
      recurrenceDates: undefined,
      excludedDates: undefined,
      occurrenceMessageIds: undefined,
      occurrenceSnapshots: undefined,
      occurrenceRecurrenceIds: undefined
    });
  });

  test("keeps recurrenceDates strictly before the cap and drops those at or after it", () => {
    const before = capMs - 1000;
    const atCap = capMs;
    const after = capMs + 1000;
    const result = pruneOccurrencesPastCap(
      makeEvent({ recurrenceDates: [after, before, atCap] }),
      capMs
    );
    expect(result.recurrenceDates).toEqual([before]);
  });

  test("returns recurrenceDates undefined when every entry is at or after the cap", () => {
    const result = pruneOccurrencesPastCap(
      makeEvent({ recurrenceDates: [capMs, capMs + 1000] }),
      capMs
    );
    expect(result.recurrenceDates).toBeUndefined();
  });

  test("returns sorted recurrenceDates when surviving entries arrived unsorted", () => {
    const earlier = capMs - 5000;
    const later = capMs - 1000;
    const result = pruneOccurrencesPastCap(
      makeEvent({ recurrenceDates: [later, earlier] }),
      capMs
    );
    expect(result.recurrenceDates).toEqual([earlier, later]);
  });

  test("filters occurrenceMessageIds by their numeric key against the cap", () => {
    const before = String(capMs - 1000);
    const atCap = String(capMs);
    const after = String(capMs + 1000);
    const result = pruneOccurrencesPastCap(
      makeEvent({
        occurrenceMessageIds: {
          [before]: "msg-before",
          [atCap]: "msg-at",
          [after]: "msg-after"
        }
      }),
      capMs
    );
    expect(result.occurrenceMessageIds).toEqual({ [before]: "msg-before" });
  });

  test("filters occurrenceSnapshots by their numeric key against the cap", () => {
    const before = String(capMs - 1000);
    const after = String(capMs + 1000);
    const result = pruneOccurrencesPastCap(
      makeEvent({
        occurrenceSnapshots: {
          [before]: { sourceSubject: "kept" },
          [after]: { sourceSubject: "dropped" }
        }
      }),
      capMs
    );
    expect(result.occurrenceSnapshots).toEqual({ [before]: { sourceSubject: "kept" } });
  });

  test("filters occurrenceRecurrenceIds by their numeric key against the cap", () => {
    const before = String(capMs - 1000);
    const after = String(capMs + 1000);
    const result = pruneOccurrencesPastCap(
      makeEvent({
        occurrenceRecurrenceIds: {
          [before]: capMs - 2000,
          [after]: capMs + 2000
        }
      }),
      capMs
    );
    expect(result.occurrenceRecurrenceIds).toEqual({ [before]: capMs - 2000 });
  });

  test("returns occurrence maps undefined when no entries survive the cap", () => {
    const after = String(capMs + 1000);
    const result = pruneOccurrencesPastCap(
      makeEvent({
        occurrenceMessageIds: { [after]: "msg" },
        occurrenceSnapshots: { [after]: { sourceSubject: "s" } },
        occurrenceRecurrenceIds: { [after]: capMs + 2000 }
      }),
      capMs
    );
    expect(result.occurrenceMessageIds).toBeUndefined();
    expect(result.occurrenceSnapshots).toBeUndefined();
    expect(result.occurrenceRecurrenceIds).toBeUndefined();
  });

  test("drops occurrence-map entries whose key is not a finite number", () => {
    const before = String(capMs - 1000);
    const result = pruneOccurrencesPastCap(
      makeEvent({
        occurrenceMessageIds: { [before]: "msg-kept", "not-a-number": "msg-bogus" }
      }),
      capMs
    );
    expect(result.occurrenceMessageIds).toEqual({ [before]: "msg-kept" });
  });

  test("passes excludedDates through untouched (the cap doesn't change cancellations)", () => {
    // EXDATE entries are cancellations against the original RRULE expansion.
    // Capping the rule narrows the window of possible occurrences; the
    // EXDATEs that fall inside the surviving window stay meaningful and
    // those past the cap are simply inert. No filtering needed.
    const exdates = [capMs - 5000, capMs - 1000, capMs + 1000];
    const result = pruneOccurrencesPastCap(makeEvent({ excludedDates: exdates }), capMs);
    expect(result.excludedDates).toEqual(exdates);
  });
});
