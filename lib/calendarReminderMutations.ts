import { parseIcsInvite } from "./calendar";

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

type CalendarEventMutationGroup = {
  eventUid: string;
  canceledWhole: boolean;
  baseUpdate: CalendarReminderUpdateMutation | null;
  addedRecurrenceDates: number[];
  addedExcludedDates: number[];
};

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
  const parsed = parseIcsInvite(icsSource);
  const method = parsed.method?.trim().toUpperCase() || "";
  const groupsByUid = new Map<string, CalendarEventMutationGroup>();

  const getGroup = (eventUid: string) => {
    let group = groupsByUid.get(eventUid);
    if (group) return group;
    group = {
      eventUid,
      canceledWhole: false,
      baseUpdate: null,
      addedRecurrenceDates: [],
      addedExcludedDates: []
    };
    groupsByUid.set(eventUid, group);
    return group;
  };

  parsed.events.forEach((event) => {
    const eventUid = event.uid?.trim();
    if (!eventUid) return;
    const group = getGroup(eventUid);
    const status = event.status?.trim().toUpperCase() || "";
    const cancelled = method === "CANCEL" || status === "CANCELLED";
    const recurrenceIdAtMs = asTimestampMs(event.recurrenceId);
    const hasRecurrenceId = Number.isFinite(recurrenceIdAtMs);

    if (cancelled) {
      if (hasRecurrenceId) {
        group.addedExcludedDates.push(recurrenceIdAtMs);
        return;
      }
      group.canceledWhole = true;
      return;
    }

    const eventStartAtMs = asTimestampMs(event.start);
    if (!Number.isFinite(eventStartAtMs)) {
      if (hasRecurrenceId) {
        group.addedExcludedDates.push(recurrenceIdAtMs);
      }
      return;
    }

    if (hasRecurrenceId) {
      group.addedExcludedDates.push(recurrenceIdAtMs);
      group.addedRecurrenceDates.push(eventStartAtMs);
      return;
    }

    group.baseUpdate = {
      kind: "update",
      eventUid,
      eventTitle: event.summary?.trim() || "Calendar event",
      eventLocation: event.location?.trim() || undefined,
      eventDescription: event.description?.trim() || undefined,
      startTimezone: event.startTimezone?.trim() || undefined,
      recurrenceRule: event.recurrenceRule?.trim() || undefined,
      recurrenceDates: event.recurrenceDates?.map((value) => value.getTime()),
      excludedDates: event.excludedDates?.map((value) => value.getTime()),
      eventStartAtMs,
      eventEndAtMs:
        event.end && Number.isFinite(event.end.getTime()) && event.end.getTime() > 0
          ? event.end.getTime()
          : undefined,
      messageId: messageId ?? undefined
    };
  });

  const mutations: CalendarReminderMutation[] = [];
  groupsByUid.forEach((group) => {
    if (group.canceledWhole) {
      mutations.push({ kind: "cancel", eventUid: group.eventUid });
      return;
    }
    if (!group.baseUpdate) {
      // Instance-only updates/cancellations are not enough to define full event state.
      return;
    }
    const mergedRecurrenceDates = normalizeDateList([
      ...(group.baseUpdate.recurrenceDates ?? []),
      ...group.addedRecurrenceDates
    ]);
    const mergedExcludedDates = normalizeDateList([
      ...(group.baseUpdate.excludedDates ?? []),
      ...group.addedExcludedDates
    ]);
    mutations.push({
      ...group.baseUpdate,
      recurrenceDates: mergedRecurrenceDates,
      excludedDates: mergedExcludedDates
    });
  });
  return mutations;
}
