import { RRule, RRuleSet } from "rrule";

export const REMINDER_DUE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

type ReminderRuleLike = {
  eventStartAtMs: number;
  leadMinutes: number;
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
  startTimezone?: string;
};

const WINDOWS_TIMEZONE_MAP: Record<string, string> = {
  "W. EUROPE STANDARD TIME": "Europe/Berlin",
  "CENTRAL EUROPE STANDARD TIME": "Europe/Budapest",
  "ROMANCE STANDARD TIME": "Europe/Paris",
  "GMT STANDARD TIME": "Europe/London",
  UTC: "UTC"
};

const timezoneValidityCache = new Map<string, boolean>();

function isValidTimeZone(timeZone: string) {
  const cached = timezoneValidityCache.get(timeZone);
  if (typeof cached === "boolean") return cached;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone }).format(new Date());
    timezoneValidityCache.set(timeZone, true);
    return true;
  } catch {
    timezoneValidityCache.set(timeZone, false);
    return false;
  }
}

export function resolveTimeZoneId(timeZone?: string) {
  const raw = timeZone?.trim();
  if (!raw) return undefined;
  const unquoted = raw.replace(/^"|"$/g, "");
  const mapped = WINDOWS_TIMEZONE_MAP[unquoted.toUpperCase()];
  if (mapped) return mapped;
  if (isValidTimeZone(unquoted)) return unquoted;
  return undefined;
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
};

function buildRecurrenceQuery(reminder: ReminderRuleLike): RecurrenceQuery | null {
  const normalizedRule = normalizeRecurrenceRule(reminder.recurrenceRule);
  if (!normalizedRule) return null;
  const startAtMs = Number(reminder.eventStartAtMs);
  if (!Number.isFinite(startAtMs) || startAtMs <= 0) return null;
  try {
    const parsed = RRule.fromString(normalizedRule);
    const rule = new RRule({
      ...parsed.origOptions,
      dtstart: new Date(startAtMs),
      tzid: resolveTimeZoneId(reminder.startTimezone) ?? parsed.origOptions.tzid
    });
    const recurrenceDates = normalizeReminderDateList(reminder.recurrenceDates);
    const excludedDates = normalizeReminderDateList(reminder.excludedDates);
    if (!recurrenceDates?.length && !excludedDates?.length) {
      return rule;
    }
    const ruleSet = new RRuleSet();
    ruleSet.rrule(rule);
    recurrenceDates?.forEach((value) => {
      ruleSet.rdate(new Date(value));
    });
    excludedDates?.forEach((value) => {
      ruleSet.exdate(new Date(value));
    });
    return ruleSet;
  } catch {
    return null;
  }
}

export function resolveNextReminderOccurrence(
  reminder: ReminderRuleLike,
  nowMs = Date.now()
): { eventStartAtMs: number; triggerAtMs: number } | null {
  const eventStartAtMs = Number(reminder.eventStartAtMs);
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
