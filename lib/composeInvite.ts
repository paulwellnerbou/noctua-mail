export type ComposeInviteDraft = {
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  recurrenceRule?: string;
};

export type ComposeInvitePayload = {
  location?: string;
  startAtMs: number;
  endAtMs?: number;
  allDay: boolean;
  recurrenceRule?: string;
};

export type RecurrenceOption =
  | "none"
  | "daily"
  | "weekly"
  | "every-2-weeks"
  | "monthly"
  | "monthly-by-day"
  | "yearly";

// Static label / rrule defaults. "monthly-by-day" is dynamic — its label and
// rrule depend on the event's start date and are computed by the helpers
// below. The entry here only exists so the option appears in the dropdown.
export const RECURRENCE_OPTIONS: { value: RecurrenceOption; label: string; rrule: string }[] = [
  { value: "none", label: "Does not repeat", rrule: "" },
  { value: "daily", label: "Daily", rrule: "FREQ=DAILY" },
  { value: "weekly", label: "Weekly", rrule: "FREQ=WEEKLY" },
  { value: "every-2-weeks", label: "Every two weeks", rrule: "FREQ=WEEKLY;INTERVAL=2" },
  { value: "monthly", label: "Monthly", rrule: "FREQ=MONTHLY" },
  { value: "monthly-by-day", label: "Monthly on weekday", rrule: "FREQ=MONTHLY" },
  { value: "yearly", label: "Yearly", rrule: "FREQ=YEARLY" }
];

const WEEKDAY_RRULE_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
] as const;
const ORDINAL_LABELS: Record<number, string> = {
  1: "first",
  2: "second",
  3: "third",
  4: "fourth",
  [-1]: "last"
};

// Map a date to its ordinal occurrence within the month for that weekday:
//   1..4 → first/second/third/fourth, -1 → last.
// We emit "last" whenever the date IS the last occurrence of its weekday in
// the month (i.e. +7 days falls into the next month), even if its raw ordinal
// is 4. Example: Feb 26 2026 is the 4th and last Thursday — we emit -1 so
// the rule fires on the LAST Thursday of every month (Mar 26, Apr 30, …)
// rather than the 4th (which would skip from Mar 26 to Apr 23).
function ordinalForStartDate(date: Date): number {
  const day = date.getDate();
  const nextWeek = new Date(date.getFullYear(), date.getMonth(), day + 7);
  if (nextWeek.getMonth() !== date.getMonth()) return -1;
  return Math.ceil(day / 7);
}

// Build a Date from a YYYY-MM-DD[THH:MM] schedule-field value, treating the
// date portion as local time. We need local components (weekday, day-of-month)
// because "every third Tuesday" is a local-time concept; inviteInputToMs uses
// UTC for all-day values and is therefore unsuitable here.
export function parseLocalScheduleDate(value: string): Date | null {
  if (!value) return null;
  const datePart = value.includes("T") ? value.slice(0, value.indexOf("T")) : value;
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function formatMonthlyByDayLabel(date: Date | null | undefined): string {
  if (!date) return "Monthly on weekday";
  const ordinal = ordinalForStartDate(date);
  const ordinalLabel = ORDINAL_LABELS[ordinal] ?? "first";
  const weekday = WEEKDAY_NAMES[date.getDay()];
  return `Monthly on the ${ordinalLabel} ${weekday}`;
}

export function buildMonthlyByDayRRule(date: Date | null | undefined): string {
  if (!date) return "FREQ=MONTHLY";
  const ordinal = ordinalForStartDate(date);
  const dayCode = WEEKDAY_RRULE_CODES[date.getDay()];
  return `FREQ=MONTHLY;BYDAY=${ordinal}${dayCode}`;
}

export function recurrenceOptionLabel(
  option: RecurrenceOption,
  startDate?: Date | null
): string {
  if (option === "monthly-by-day") return formatMonthlyByDayLabel(startDate ?? null);
  return RECURRENCE_OPTIONS.find((item) => item.value === option)?.label ?? "";
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

export function msToDateTimeLocal(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

export function msToDateLocal(ms: number): string {
  const date = new Date(ms);
  // Use UTC components so all-day dates (treated as UTC elsewhere) do not shift across timezones.
  return `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`;
}

export function inviteInputToMs(value: string, allDay: boolean): number {
  if (allDay) {
    // Expect value in "YYYY-MM-DD" format for all-day events and interpret as UTC midnight.
    const [yearStr, monthStr, dayStr] = value.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    return Date.UTC(year, month - 1, day);
  }
  return new Date(value).getTime();
}

export function toggleAllDayInputValue(
  value: string,
  nextAllDay: boolean,
  fallbackTime: string
) {
  if (!value) return value;
  if (nextAllDay) return value.split("T")[0] ?? value;
  return value.includes("T") ? value : `${value}T${fallbackTime}`;
}

export function addMinutesToInviteInput(value: string, minutes: number, allDay: boolean): string {
  const startAtMs = inviteInputToMs(value, allDay);
  if (!Number.isFinite(startAtMs)) return value;
  if (allDay) return msToDateLocal(startAtMs + minutes * 60 * 1000);
  return msToDateTimeLocal(startAtMs + minutes * 60 * 1000);
}

export function getEndValueAfterStartChange(
  startValue: string,
  endValue: string,
  allDay: boolean,
  minimumDurationMinutes = 30
): string {
  if (!startValue || !endValue) return endValue;
  const startAtMs = inviteInputToMs(startValue, allDay);
  const endAtMs = inviteInputToMs(endValue, allDay);
  if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs)) return endValue;
  if (endAtMs >= startAtMs) return endValue;
  return addMinutesToInviteInput(startValue, minimumDurationMinutes, allDay);
}

type ScheduleComponents = { y: number; mo: number; d: number; h: number; min: number };

function parseScheduleComponents(value: string, allDay: boolean): ScheduleComponents | null {
  if (!value) return null;
  if (allDay) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    return { y: Number(match[1]), mo: Number(match[2]), d: Number(match[3]), h: 0, min: 0 };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return {
    y: Number(match[1]),
    mo: Number(match[2]),
    d: Number(match[3]),
    h: Number(match[4]),
    min: Number(match[5])
  };
}

// Treat local wall-clock components as if they were UTC. This sidesteps DST:
// subtracting two such ms always gives the wall-clock minutes between them.
function componentsAsUtcMs(c: ScheduleComponents): number {
  return Date.UTC(c.y, c.mo - 1, c.d, c.h, c.min);
}

function utcMsToScheduleValue(ms: number, allDay: boolean): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = padDatePart(d.getUTCMonth() + 1);
  const day = padDatePart(d.getUTCDate());
  if (allDay) return `${y}-${mo}-${day}`;
  return `${y}-${mo}-${day}T${padDatePart(d.getUTCHours())}:${padDatePart(d.getUTCMinutes())}`;
}

// Shift end so the duration between prev start and prev end is preserved
// after start moves to nextStart. Used so editing the start time slides the
// whole event without breaking its length. Editing the end stays a pure
// duration change and does not go through this helper.
//
// Wall-clock arithmetic: components are projected into UTC so a 25-hour
// wall-clock span across a DST spring-forward stays 25 wall-clock hours when
// re-applied to a non-DST-spanning week (real-elapsed ms would be 24h).
export function shiftEndPreservingDuration(
  prevStartValue: string,
  nextStartValue: string,
  prevEndValue: string,
  allDay: boolean,
  fallbackMinutes = 30
): string {
  // No new start → leave end alone (matches the legacy helper).
  if (!nextStartValue) {
    return getEndValueAfterStartChange(nextStartValue, prevEndValue, allDay, fallbackMinutes);
  }
  // New start but no previous end → seed the end at `start + fallbackMinutes`
  // so an event that lacked an end gets one. (The legacy helper would have
  // returned "" here, leaving the event end-less.)
  if (!prevEndValue) {
    return addMinutesToInviteInput(nextStartValue, fallbackMinutes, allDay);
  }
  // Without a previous start we cannot compute the duration; fall back to the
  // legacy "keep end ≥ start" behaviour so callers still get a sane value.
  if (!prevStartValue) {
    return getEndValueAfterStartChange(nextStartValue, prevEndValue, allDay, fallbackMinutes);
  }
  const prevStart = parseScheduleComponents(prevStartValue, allDay);
  const nextStart = parseScheduleComponents(nextStartValue, allDay);
  const prevEnd = parseScheduleComponents(prevEndValue, allDay);
  if (!prevStart || !nextStart || !prevEnd) {
    return getEndValueAfterStartChange(nextStartValue, prevEndValue, allDay, fallbackMinutes);
  }
  const durationMs = componentsAsUtcMs(prevEnd) - componentsAsUtcMs(prevStart);
  const minimumDurationMs = fallbackMinutes * 60 * 1000;
  const effectiveDurationMs = durationMs > 0 ? durationMs : minimumDurationMs;
  const nextEndMs = componentsAsUtcMs(nextStart) + effectiveDurationMs;
  return utcMsToScheduleValue(nextEndMs, allDay);
}

export function rruleToOption(rule?: string): RecurrenceOption {
  const upper = rule?.trim().toUpperCase() ?? "";
  if (!upper) return "none";
  // INTERVAL=2 with WEEKLY is the only multi-interval value we surface; any
  // other INTERVAL falls through to its base FREQ option (we round-trip-lose
  // the interval rather than mislabel it).
  if (upper.includes("WEEKLY") && /(?:^|;)INTERVAL=2(?:;|$)/.test(upper)) return "every-2-weeks";
  // FREQ=MONTHLY with a single BYDAY=<ordinal><weekday> (ordinal ∈ 1..4 or -1)
  // is our date-aware "Monthly on the Nth <weekday>" preset.
  if (
    upper.includes("MONTHLY") &&
    /(?:^|;)BYDAY=(?:-1|[1-4])(?:SU|MO|TU|WE|TH|FR|SA)(?:;|$)/.test(upper)
  ) {
    return "monthly-by-day";
  }
  if (upper.includes("DAILY")) return "daily";
  if (upper.includes("WEEKLY")) return "weekly";
  if (upper.includes("MONTHLY")) return "monthly";
  if (upper.includes("YEARLY")) return "yearly";
  return "none";
}

export function recurrenceOptionToRRule(
  option: RecurrenceOption,
  startDate?: Date | null
): string {
  if (option === "monthly-by-day") return buildMonthlyByDayRRule(startDate ?? null);
  return RECURRENCE_OPTIONS.find((item) => item.value === option)?.rrule ?? "";
}

export function createDefaultComposeInviteDraft(nowMs = Date.now()): ComposeInviteDraft {
  const startAtMs = nowMs;
  const endAtMs = nowMs + 60 * 60 * 1000;
  return {
    location: "",
    start: msToDateTimeLocal(startAtMs),
    end: msToDateTimeLocal(endAtMs),
    allDay: false,
    recurrenceRule: ""
  };
}

export function normalizeComposeInviteDraft(
  draft?: ComposeInviteDraft | null
): ComposeInviteDraft | null {
  if (!draft) return null;
  const location = draft.location?.trim() ?? "";
  const start = draft.start?.trim() ?? "";
  const end = draft.end?.trim() ?? "";
  const recurrenceRule = draft.recurrenceRule?.trim() ?? "";
  if (!location && !start && !end && !recurrenceRule) return null;
  return {
    location: location || undefined,
    start,
    end,
    allDay: Boolean(draft.allDay),
    recurrenceRule: recurrenceRule || undefined
  };
}

export function hasComposeInviteDraftContent(draft?: ComposeInviteDraft | null) {
  const normalized = normalizeComposeInviteDraft(draft);
  return Boolean(normalized);
}

export function buildComposeInvitePayload(
  draft?: ComposeInviteDraft | null
): ComposeInvitePayload | null {
  const normalized = normalizeComposeInviteDraft(draft);
  if (!normalized) return null;
  if (!normalized.start) return null;

  const startAtMs = inviteInputToMs(normalized.start, normalized.allDay);
  if (!Number.isFinite(startAtMs)) return null;

  const endAtMs = normalized.end ? inviteInputToMs(normalized.end, normalized.allDay) : Number.NaN;
  return {
    location: normalized.location,
    startAtMs,
    endAtMs: Number.isFinite(endAtMs) ? endAtMs : undefined,
    allDay: normalized.allDay,
    recurrenceRule: normalized.recurrenceRule
  };
}
