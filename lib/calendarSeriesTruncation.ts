import { RRule } from "rrule";
import { resolveCalendarTimeZoneId, toCalendarTimeZoneWallDate } from "./calendarTimezones";

export type SeriesTruncationInput = {
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
  startTimezone?: string;
};

export type SeriesTruncationResult = {
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
};

// One second of slack so UNTIL lands strictly before the cutoff occurrence
// without clipping the previous one, even at second-granularity serialization.
const TRUNCATION_EPSILON_MS = 1000;

function normalizeRule(rule?: string): string | null {
  const value = rule?.trim();
  if (!value) return null;
  if (value.toUpperCase().startsWith("RRULE:")) {
    return value.slice(6).trim() || null;
  }
  return value;
}

function trimBeforeCutoff(values: number[] | undefined, cutoffStartAtMs: number) {
  if (!Array.isArray(values)) return [];
  return values.filter((value) => Number.isFinite(value) && value < cutoffStartAtMs);
}

/**
 * Truncates a recurring series so the occurrence at `cutoffStartAtMs` and every
 * later occurrence are dropped ("this and all following"). Caps the rule with
 * UNTIL just before the cutoff and removes any RDATE/EXDATE at or after it.
 *
 * UNTIL is stored in wall-clock space to match recurrence expansion, which
 * shifts DTSTART to wall time but leaves UNTIL untouched (see
 * `buildRecurrenceQuery`); a real-instant bound would otherwise mis-truncate in
 * zones with a negative UTC offset.
 */
export function truncateRecurrenceBeforeOccurrence(
  input: SeriesTruncationInput,
  cutoffStartAtMs: number
): SeriesTruncationResult {
  // A bad cutoff would trim every date list and produce an invalid UNTIL;
  // leave the series untouched rather than silently lose data.
  if (!Number.isFinite(cutoffStartAtMs) || cutoffStartAtMs <= 0) {
    return {
      recurrenceRule: input.recurrenceRule,
      recurrenceDates: input.recurrenceDates,
      excludedDates: input.excludedDates
    };
  }

  const recurrenceDates = trimBeforeCutoff(input.recurrenceDates, cutoffStartAtMs);
  const excludedDates = trimBeforeCutoff(input.excludedDates, cutoffStartAtMs);
  const normalized = normalizeRule(input.recurrenceRule);

  let recurrenceRule = input.recurrenceRule;
  if (normalized) {
    try {
      const parsed = RRule.fromString(normalized);
      const parsedTzid =
        typeof parsed.origOptions.tzid === "string" ? parsed.origOptions.tzid : undefined;
      const tz =
        resolveCalendarTimeZoneId(input.startTimezone) ?? resolveCalendarTimeZoneId(parsedTzid);
      const cutoffWallMs = tz
        ? toCalendarTimeZoneWallDate(new Date(cutoffStartAtMs), tz).getTime()
        : cutoffStartAtMs;
      // Never raise an existing UNTIL: a later cap would revive base-rule
      // occurrences that the original rule already ended (e.g. when the cutoff
      // occurrence comes only from an RDATE past the rule's own UNTIL).
      const existingUntilMs =
        parsed.origOptions.until instanceof Date ? parsed.origOptions.until.getTime() : null;
      const cappedUntilMs = cutoffWallMs - TRUNCATION_EPSILON_MS;
      const until = new Date(
        existingUntilMs !== null ? Math.min(existingUntilMs, cappedUntilMs) : cappedUntilMs
      );
      // COUNT and UNTIL are mutually exclusive per RFC 5545; drop COUNT.
      const truncated = new RRule({ ...parsed.origOptions, count: null, until });
      recurrenceRule = truncated.toString().replace(/^RRULE:/, "");
    } catch {
      // Unparseable rule: leave it untouched and rely on the trimmed date lists.
    }
  }

  return {
    recurrenceRule,
    recurrenceDates: recurrenceDates.length > 0 ? recurrenceDates : undefined,
    excludedDates: excludedDates.length > 0 ? excludedDates : undefined
  };
}
