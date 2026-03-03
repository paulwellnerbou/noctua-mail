import {
  collectCalendarInviteMutationGroups,
  inferCalendarInviteActionType
} from "./calendarInviteProcessing";

export type CalendarReminderMutation =
  | { kind: "cancel"; eventUid: string }
  | {
      kind: "update";
      eventUid: string;
      eventTitle: string;
      eventLocation?: string;
      eventDescription?: string;
      startTimezone?: string;
      recurrenceRule?: string;
      recurrenceDates?: number[];
      excludedDates?: number[];
      eventStartAtMs: number;
      eventEndAtMs?: number;
      messageId?: string;
    };

type CalendarReminderUpdateMutation = Extract<CalendarReminderMutation, { kind: "update" }>;

function normalizeDateList(values: number[]) {
  if (values.length === 0) return undefined;
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

function asTimestampMs(value?: Date) {
  if (!value) return Number.NaN;
  const timestamp = value.getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Number.NaN;
}

export function collectCalendarReminderMutationsFromCalendarInvite(
  icsSource: string,
  messageId?: string | null
): CalendarReminderMutation[] {
  const groups = collectCalendarInviteMutationGroups(icsSource);

  const mutations: CalendarReminderMutation[] = [];
  groups.forEach((group) => {
    if (inferCalendarInviteActionType(group) === "cancellation") {
      mutations.push({ kind: "cancel", eventUid: group.eventUid });
      return;
    }
    if (!group.baseEvent) {
      // Instance-only updates/cancellations are not enough to define full event state.
      return;
    }
    const eventStartAtMs = asTimestampMs(group.baseEvent.start);
    if (!Number.isFinite(eventStartAtMs)) return;
    const baseUpdate: CalendarReminderUpdateMutation = {
      kind: "update",
      eventUid: group.eventUid,
      eventTitle: group.baseEvent.summary?.trim() || "Calendar event",
      eventLocation: group.baseEvent.location?.trim() || undefined,
      eventDescription: group.baseEvent.description?.trim() || undefined,
      startTimezone: group.baseEvent.startTimezone?.trim() || undefined,
      recurrenceRule: group.baseEvent.recurrenceRule?.trim() || undefined,
      recurrenceDates: group.baseEvent.recurrenceDates?.map((value) => value.getTime()),
      excludedDates: group.baseEvent.excludedDates?.map((value) => value.getTime()),
      eventStartAtMs,
      eventEndAtMs:
        group.baseEvent.end &&
        Number.isFinite(group.baseEvent.end.getTime()) &&
        group.baseEvent.end.getTime() > 0
          ? group.baseEvent.end.getTime()
          : undefined,
      messageId: messageId ?? undefined
    };
    const mergedRecurrenceDates = normalizeDateList([
      ...(baseUpdate.recurrenceDates ?? []),
      ...group.addedRecurrenceDates
    ]);
    const mergedExcludedDates = normalizeDateList([
      ...(baseUpdate.excludedDates ?? []),
      ...group.addedExcludedDates
    ]);
    mutations.push({
      ...baseUpdate,
      recurrenceDates: mergedRecurrenceDates,
      excludedDates: mergedExcludedDates
    });
  });
  return mutations;
}
