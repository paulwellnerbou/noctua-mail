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

export type RecurrenceOption = "none" | "daily" | "weekly" | "monthly" | "yearly";

export const RECURRENCE_OPTIONS: { value: RecurrenceOption; label: string; rrule: string }[] = [
  { value: "none", label: "Does not repeat", rrule: "" },
  { value: "daily", label: "Daily", rrule: "FREQ=DAILY" },
  { value: "weekly", label: "Weekly", rrule: "FREQ=WEEKLY" },
  { value: "monthly", label: "Monthly", rrule: "FREQ=MONTHLY" },
  { value: "yearly", label: "Yearly", rrule: "FREQ=YEARLY" }
];

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

export function rruleToOption(rule?: string): RecurrenceOption {
  const upper = rule?.trim().toUpperCase() ?? "";
  if (!upper) return "none";
  if (upper.includes("DAILY")) return "daily";
  if (upper.includes("WEEKLY")) return "weekly";
  if (upper.includes("MONTHLY")) return "monthly";
  if (upper.includes("YEARLY")) return "yearly";
  return "none";
}

export function recurrenceOptionToRRule(option: RecurrenceOption): string {
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
