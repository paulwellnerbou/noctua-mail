import { RRule, RRuleSet } from "rrule";
import {
  fromCalendarTimeZoneWallDate,
  resolveCalendarTimeZoneId,
  toCalendarTimeZoneWallDate
} from "./calendarTimezones";

export const REMINDER_DUE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

type RecurrenceRuleLike = {
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

function buildRecurrenceQuery(reminder: RecurrenceRuleLike): RecurrenceQuery | null {
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

export function listRecurrenceOccurrenceStartsInRange(
  reminder: Omit<RecurrenceRuleLike, "leadMinutes">,
  rangeStartMs: number,
  rangeEndMs: number
): number[] {
  const eventStartAtMs = Number(reminder.eventStartAtMs);
  const eventEndAtMsRaw = Number(reminder.eventEndAtMs);
  const durationMs =
    Number.isFinite(eventEndAtMsRaw) && eventEndAtMsRaw > eventStartAtMs
      ? eventEndAtMsRaw - eventStartAtMs
      : Number.NaN;
  if (
    !Number.isFinite(eventStartAtMs) ||
    eventStartAtMs <= 0 ||
    !Number.isFinite(rangeStartMs) ||
    !Number.isFinite(rangeEndMs) ||
    rangeEndMs <= rangeStartMs
  ) {
    return [];
  }

  const recurrence = buildRecurrenceQuery({
    ...reminder,
    leadMinutes: 0
  });
  if (!recurrence) {
    if (eventStartAtMs >= rangeStartMs && eventStartAtMs < rangeEndMs) {
      return [eventStartAtMs];
    }
    if (
      Number.isFinite(durationMs) &&
      durationMs > 0 &&
      eventStartAtMs < rangeStartMs &&
      eventStartAtMs + durationMs > rangeStartMs
    ) {
      return [eventStartAtMs];
    }
    return [];
  }

  const occurrenceStarts: number[] = [];
  const seen = new Set<number>();
  const pushOccurrence = (value?: Date | null) => {
    if (!value) return;
    const atMs = value.getTime();
    if (!Number.isFinite(atMs) || atMs <= 0 || atMs >= rangeEndMs) return;
    if (
      atMs < rangeStartMs &&
      (!Number.isFinite(durationMs) || durationMs <= 0 || atMs + durationMs <= rangeStartMs)
    ) {
      return;
    }
    if (seen.has(atMs)) return;
    seen.add(atMs);
    occurrenceStarts.push(atMs);
  };

  if (Number.isFinite(durationMs) && durationMs > 0) {
    pushOccurrence(recurrence.before(new Date(rangeStartMs), true));
  }

  let cursor = recurrence.after(new Date(rangeStartMs), true);
  let iterations = 0;
  while (cursor && cursor.getTime() < rangeEndMs && iterations < 4096) {
    pushOccurrence(cursor);
    cursor = recurrence.after(cursor, false);
    iterations += 1;
  }

  occurrenceStarts.sort((a, b) => a - b);
  return occurrenceStarts;
}

export function hasFutureEventOccurrence(
  event: Omit<RecurrenceRuleLike, "leadMinutes">,
  nowMs = Date.now()
): boolean {
  const startMs = Number(event.eventStartAtMs);
  if (!Number.isFinite(startMs) || startMs <= 0) return false;
  const endMsRaw = Number(event.eventEndAtMs);
  const durationMs =
    Number.isFinite(endMsRaw) && endMsRaw > startMs ? endMsRaw - startMs : 0;

  const recurrence = buildRecurrenceQuery({ ...event, leadMinutes: 0 });
  if (!recurrence) {
    return (durationMs > 0 ? startMs + durationMs : startMs) > nowMs;
  }

  if (recurrence.after(new Date(nowMs), true)) return true;
  if (durationMs > 0) {
    const prev = recurrence.before(new Date(nowMs), true);
    if (prev && prev.getTime() + durationMs > nowMs) return true;
  }
  return false;
}

export function resolveNextReminderOccurrence(
  reminder: RecurrenceRuleLike,
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

  const nextByStart = recurrence.after(new Date(nowMs), true);
  if (nextByStart) {
    const nextStartAtMs = nextByStart.getTime();
    if (
      Number.isFinite(nextStartAtMs) &&
      nextStartAtMs > 0 &&
      nextStartAtMs - leadMs <= nowMs
    ) {
      return {
        eventStartAtMs: nextStartAtMs,
        triggerAtMs: nextStartAtMs - leadMs
      };
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

export function resolveCurrentOrNextOccurrence(
  reminder: Omit<RecurrenceRuleLike, "leadMinutes">,
  nowMs = Date.now()
): { eventStartAtMs: number } | null {
  const eventStartAtMs = Number(reminder.eventStartAtMs);
  const eventEndAtMsRaw = Number(reminder.eventEndAtMs);
  const durationMs =
    Number.isFinite(eventEndAtMsRaw) && eventEndAtMsRaw > eventStartAtMs
      ? eventEndAtMsRaw - eventStartAtMs
      : Number.NaN;
  if (!Number.isFinite(eventStartAtMs) || eventStartAtMs <= 0) {
    return null;
  }

  const recurrence = buildRecurrenceQuery({
    ...reminder,
    leadMinutes: 0
  });
  if (!recurrence) {
    if (
      Number.isFinite(durationMs) &&
      durationMs > 0 &&
      nowMs >= eventStartAtMs &&
      nowMs < eventStartAtMs + durationMs
    ) {
      return { eventStartAtMs };
    }
    return eventStartAtMs >= nowMs ? { eventStartAtMs } : null;
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
        return { eventStartAtMs: currentOccurrenceStartAtMs };
      }
    }
  }

  const nextOccurrence = recurrence.after(new Date(nowMs), true);
  if (!nextOccurrence) return null;
  const nextEventStartAtMs = nextOccurrence.getTime();
  if (!Number.isFinite(nextEventStartAtMs) || nextEventStartAtMs <= 0) {
    return null;
  }
  return { eventStartAtMs: nextEventStartAtMs };
}
