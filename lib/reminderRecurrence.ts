import { RRule, RRuleSet } from "rrule";
import {
  fromCalendarTimeZoneWallDate,
  resolveCalendarTimeZoneId,
  toCalendarTimeZoneWallDate
} from "./calendarTimezones";

export const REMINDER_DUE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

type ReminderRuleLike = {
  eventStartAtMs: number;
  eventEndAtMs?: number;
  leadMinutes: number;
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
  startTimezone?: string;
};

export function resolveTimeZoneId(timeZone?: string) {
  return resolveCalendarTimeZoneId(timeZone);
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

export function normalizeReminderDateList(values?: number[]) {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const next = Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.round(value))
    )
  ).sort((a, b) => a - b);
  return next.length > 0 ? next : undefined;
}

type RecurrenceQuery = {
  after: (date: Date, inc?: boolean) => Date | null;
  before: (date: Date, inc?: boolean) => Date | null;
};

function buildRecurrenceQuery(reminder: ReminderRuleLike): RecurrenceQuery | null {
  const normalizedRule = normalizeRecurrenceRule(reminder.recurrenceRule);
  if (!normalizedRule) return null;
  const startAtMs = Number(reminder.eventStartAtMs);
  if (!Number.isFinite(startAtMs) || startAtMs <= 0) return null;
  try {
    const parsed = RRule.fromString(normalizedRule);
    const parsedTzid =
      typeof parsed.origOptions.tzid === "string" ? parsed.origOptions.tzid : undefined;
    const ruleTimeZone = resolveTimeZoneId(reminder.startTimezone) ?? resolveTimeZoneId(parsedTzid);
    const toRuleDate = (value: number) => {
      const date = new Date(value);
      return ruleTimeZone ? toCalendarTimeZoneWallDate(date, ruleTimeZone) : date;
    };
    const fromRuleDate = (date: Date) =>
      ruleTimeZone ? fromCalendarTimeZoneWallDate(date, ruleTimeZone) : date;
    const rule = new RRule({
      ...parsed.origOptions,
      dtstart: toRuleDate(startAtMs),
      // Expand recurrence in wall-clock space so output is stable across process TZ.
      tzid: ruleTimeZone ? undefined : parsed.origOptions.tzid
    });
    const recurrenceDates = normalizeReminderDateList(reminder.recurrenceDates);
    const excludedDates = normalizeReminderDateList(reminder.excludedDates);
    const recurrenceSource: RecurrenceQuery = (() => {
      if (!recurrenceDates?.length && !excludedDates?.length) {
        return rule;
      }
      const ruleSet = new RRuleSet();
      ruleSet.rrule(rule);
      recurrenceDates?.forEach((value) => {
        ruleSet.rdate(toRuleDate(value));
      });
      excludedDates?.forEach((value) => {
        ruleSet.exdate(toRuleDate(value));
      });
      return ruleSet;
    })();
    if (!ruleTimeZone) {
      return recurrenceSource;
    }
    return {
      after(date: Date, inc?: boolean) {
        const next = recurrenceSource.after(toCalendarTimeZoneWallDate(date, ruleTimeZone), inc);
        return next ? fromRuleDate(next) : null;
      },
      before(date: Date, inc?: boolean) {
        const previous = recurrenceSource.before(toCalendarTimeZoneWallDate(date, ruleTimeZone), inc);
        return previous ? fromRuleDate(previous) : null;
      }
    };
  } catch {
    return null;
  }
}

export function resolveNextReminderOccurrence(
  reminder: ReminderRuleLike,
  nowMs = Date.now()
): { eventStartAtMs: number; triggerAtMs: number } | null {
  const eventStartAtMs = Number(reminder.eventStartAtMs);
  const eventEndAtMsRaw = Number(reminder.eventEndAtMs);
  const durationMs =
    Number.isFinite(eventEndAtMsRaw) && eventEndAtMsRaw > eventStartAtMs
      ? eventEndAtMsRaw - eventStartAtMs
      : Number.NaN;
  const leadMinutes = Math.max(0, Number(reminder.leadMinutes));
  if (!Number.isFinite(eventStartAtMs) || eventStartAtMs <= 0 || !Number.isFinite(leadMinutes)) {
    return null;
  }
  const leadMs = leadMinutes * 60 * 1000;
  const recurrence = buildRecurrenceQuery(reminder);
  if (!recurrence) {
    const triggerAtMs = eventStartAtMs - leadMs;
    if (triggerAtMs >= nowMs) {
      return { eventStartAtMs, triggerAtMs };
    }
    if (triggerAtMs < nowMs - REMINDER_DUE_LOOKBACK_MS) {
      return null;
    }
    return { eventStartAtMs, triggerAtMs };
  }

  if (Number.isFinite(durationMs) && durationMs > 0) {
    const currentOccurrenceStart = recurrence.before(new Date(nowMs), true);
    if (currentOccurrenceStart) {
      const currentOccurrenceStartAtMs = currentOccurrenceStart.getTime();
      if (
        Number.isFinite(currentOccurrenceStartAtMs) &&
        currentOccurrenceStartAtMs > 0 &&
        nowMs < currentOccurrenceStartAtMs + durationMs
      ) {
        return {
          eventStartAtMs: currentOccurrenceStartAtMs,
          triggerAtMs: currentOccurrenceStartAtMs - leadMs
        };
      }
    }
  }

  const nextUpcoming = recurrence.after(new Date(nowMs + leadMs), true);
  if (nextUpcoming) {
    const nextEventStartAtMs = nextUpcoming.getTime();
    if (!Number.isFinite(nextEventStartAtMs) || nextEventStartAtMs <= 0) return null;
    return {
      eventStartAtMs: nextEventStartAtMs,
      triggerAtMs: nextEventStartAtMs - leadMs
    };
  }

  const earliestRelevantStartMs = nowMs - REMINDER_DUE_LOOKBACK_MS + leadMs;
  let cursor = recurrence.after(new Date(earliestRelevantStartMs), true);
  let latestInLookback = cursor;
  let iterations = 0;
  while (cursor && cursor.getTime() - leadMs <= nowMs && iterations < 2048) {
    latestInLookback = cursor;
    cursor = recurrence.after(cursor, false);
    iterations += 1;
  }
  if (!latestInLookback) return null;
  const nextEventStartAtMs = latestInLookback.getTime();
  if (!Number.isFinite(nextEventStartAtMs) || nextEventStartAtMs <= 0) {
    return null;
  }
  return {
    eventStartAtMs: nextEventStartAtMs,
    triggerAtMs: nextEventStartAtMs - leadMs
  };
}
