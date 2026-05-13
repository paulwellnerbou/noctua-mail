import { describe, expect, test } from "bun:test";
import { capRecurrenceRuleAtUtcMs } from "./calendarSeriesReanchor";

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
