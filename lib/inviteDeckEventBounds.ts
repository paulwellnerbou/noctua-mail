import { RRule, RRuleSet } from "rrule";
import type { CalendarInviteMutationGroup } from "./calendarInviteProcessing";
import {
  fromCalendarTimeZoneWallDate,
  resolveCalendarTimeZoneId,
  toCalendarTimeZoneWallDate
} from "./calendarTimezones";

export type InviteDeckEventBounds = {
  eventFirstStartAtMs?: number;
  eventLastEndAtMs?: number | null;
};

type RecurrenceTimeline = {
  firstOnOrAfter: (timestampMs: number) => Date | null;
  lastOnOrBefore: (timestampMs: number) => Date | null;
  lastBoundedOccurrence: () => Date | null;
  isBounded: boolean;
};

function asTimestampMs(value?: Date) {
  if (!value) return Number.NaN;
  const timestamp = value.getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.round(timestamp) : Number.NaN;
}

function normalizeDateList(values?: number[]) {
  if (!Array.isArray(values) || values.length === 0) return [];
  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.round(value))
    )
  ).sort((a, b) => a - b);
}

function normalizeRecurrenceRule(rule?: string) {
  const value = rule?.trim();
  if (!value) return null;
  if (value.toUpperCase().startsWith("RRULE:")) {
    const trimmed = value.slice(6).trim();
    return trimmed || null;
  }
  return value;
}

function buildRecurrenceTimeline(params: {
  eventStartAtMs: number;
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
  startTimezone?: string;
}): RecurrenceTimeline | null {
  const normalizedRule = normalizeRecurrenceRule(params.recurrenceRule);
  if (!normalizedRule) return null;
  const eventStartAtMs = Number(params.eventStartAtMs);
  if (!Number.isFinite(eventStartAtMs) || eventStartAtMs <= 0) return null;

  try {
    const parsed = RRule.fromString(normalizedRule);
    const parsedTzid =
      typeof parsed.origOptions.tzid === "string" ? parsed.origOptions.tzid : undefined;
    const ruleTimeZone =
      resolveCalendarTimeZoneId(params.startTimezone) ?? resolveCalendarTimeZoneId(parsedTzid);
    const toRuleDate = (value: number) => {
      const date = new Date(value);
      return ruleTimeZone ? toCalendarTimeZoneWallDate(date, ruleTimeZone) : date;
    };
    const fromRuleDate = (date: Date) =>
      ruleTimeZone ? fromCalendarTimeZoneWallDate(date, ruleTimeZone) : date;
    const originalUntil =
      parsed.origOptions.until instanceof Date ? parsed.origOptions.until : null;
    const rule = new RRule({
      ...parsed.origOptions,
      dtstart: toRuleDate(eventStartAtMs),
      until:
        originalUntil && ruleTimeZone
          ? toCalendarTimeZoneWallDate(originalUntil, ruleTimeZone)
          : parsed.origOptions.until,
      tzid: ruleTimeZone ? undefined : parsed.origOptions.tzid
    });
    const recurrenceDates = normalizeDateList(params.recurrenceDates);
    const excludedDates = normalizeDateList(params.excludedDates);
    const recurrenceSource =
      recurrenceDates.length === 0 && excludedDates.length === 0
        ? rule
        : (() => {
            const ruleSet = new RRuleSet();
            ruleSet.rrule(rule);
            recurrenceDates.forEach((value) => {
              ruleSet.rdate(toRuleDate(value));
            });
            excludedDates.forEach((value) => {
              ruleSet.exdate(toRuleDate(value));
            });
            return ruleSet;
          })();
    const isBounded =
      (typeof parsed.origOptions.count === "number" && parsed.origOptions.count > 0) ||
      parsed.origOptions.until instanceof Date;
    const untilAtMs = asTimestampMs(
      parsed.origOptions.until instanceof Date ? parsed.origOptions.until : undefined
    );

    return {
      firstOnOrAfter(timestampMs: number) {
        const queryDate = new Date(timestampMs);
        const next = recurrenceSource.after(
          ruleTimeZone ? toCalendarTimeZoneWallDate(queryDate, ruleTimeZone) : queryDate,
          true
        );
        return next ? fromRuleDate(next) : null;
      },
      lastOnOrBefore(timestampMs: number) {
        const queryDate = new Date(timestampMs);
        const previous = recurrenceSource.before(
          ruleTimeZone ? toCalendarTimeZoneWallDate(queryDate, ruleTimeZone) : queryDate,
          true
        );
        return previous ? fromRuleDate(previous) : null;
      },
      lastBoundedOccurrence() {
        if (!isBounded) return null;
        if (Number.isFinite(untilAtMs)) {
          const previous = recurrenceSource.before(toRuleDate(untilAtMs), true);
          return previous ? fromRuleDate(previous) : null;
        }
        const occurrences = recurrenceSource.all();
        const last = occurrences[occurrences.length - 1];
        return last ? fromRuleDate(last) : null;
      },
      isBounded
    };
  } catch {
    return null;
  }
}

export function deriveInviteDeckEventBounds(
  group: CalendarInviteMutationGroup
): InviteDeckEventBounds {
  const baseStartAtMs = asTimestampMs(group.baseEvent?.start);
  const baseEndAtMs = asTimestampMs(group.baseEvent?.end);
  const baseDurationMs =
    Number.isFinite(baseStartAtMs) &&
    Number.isFinite(baseEndAtMs) &&
    baseEndAtMs > baseStartAtMs
      ? baseEndAtMs - baseStartAtMs
      : 0;
  const instanceOccurrences = Array.from(
    new Map(
      group.instanceOccurrences
        .filter((occurrence) => Number.isFinite(occurrence.startAtMs) && occurrence.startAtMs > 0)
        .map((occurrence) => [
          occurrence.startAtMs,
          Number.isFinite(occurrence.endAtMs) && (occurrence.endAtMs ?? 0) > occurrence.startAtMs
            ? occurrence.endAtMs
            : undefined
        ])
    ).entries()
  ).map(([startAtMs, endAtMs]) => ({ startAtMs, endAtMs }));

  if (!Number.isFinite(baseStartAtMs)) {
    if (instanceOccurrences.length === 0) {
      return {};
    }
    const starts = instanceOccurrences.map((occurrence) => occurrence.startAtMs);
    const ends = instanceOccurrences.map((occurrence) =>
      occurrence.endAtMs && occurrence.endAtMs > occurrence.startAtMs
        ? occurrence.endAtMs
        : occurrence.startAtMs
    );
    return {
      eventFirstStartAtMs: Math.min(...starts),
      eventLastEndAtMs: Math.max(...ends)
    };
  }

  const recurrenceDates = normalizeDateList([
    ...(group.baseEvent?.recurrenceDates?.map((value) => value.getTime()) ?? []),
    ...group.addedRecurrenceDates
  ]);
  const excludedDates = normalizeDateList([
    ...(group.baseEvent?.excludedDates?.map((value) => value.getTime()) ?? []),
    ...group.addedExcludedDates
  ]);
  const recurrenceRule = group.baseEvent?.recurrenceRule?.trim() || undefined;
  const explicitEndByStart = new Map<number, number>();
  instanceOccurrences.forEach((occurrence) => {
    if (
      Number.isFinite(occurrence.endAtMs) &&
      (occurrence.endAtMs ?? 0) > occurrence.startAtMs
    ) {
      explicitEndByStart.set(occurrence.startAtMs, occurrence.endAtMs!);
    }
  });
  const resolveOccurrenceEndAtMs = (startAtMs: number) =>
    explicitEndByStart.get(startAtMs) ??
    (baseDurationMs > 0 ? startAtMs + baseDurationMs : startAtMs);

  const timeline = buildRecurrenceTimeline({
    eventStartAtMs: baseStartAtMs,
    recurrenceRule,
    recurrenceDates,
    excludedDates,
    startTimezone: group.baseEvent?.startTimezone
  });

  if (timeline?.isBounded) {
    const firstOccurrence = timeline.firstOnOrAfter(baseStartAtMs - 1);
    if (!firstOccurrence) {
      return {};
    }
    const lastOccurrence = timeline.lastBoundedOccurrence();
    if (!lastOccurrence) {
      return {};
    }
    return {
      eventFirstStartAtMs: firstOccurrence.getTime(),
      eventLastEndAtMs: resolveOccurrenceEndAtMs(lastOccurrence.getTime())
    };
  }

  if (timeline) {
    const firstOccurrence = timeline.firstOnOrAfter(baseStartAtMs - 1);
    if (!firstOccurrence) {
      return {};
    }
    return {
      eventFirstStartAtMs: firstOccurrence.getTime(),
      eventLastEndAtMs: null
    };
  }

  const starts = normalizeDateList([baseStartAtMs, ...recurrenceDates]).filter(
    (value) => !excludedDates.includes(value)
  );
  if (starts.length === 0) {
    return {};
  }
  return {
    eventFirstStartAtMs: starts[0],
    eventLastEndAtMs: resolveOccurrenceEndAtMs(starts[starts.length - 1])
  };
}
