import { parseIcsInvite, type CalendarEventPreview } from "./calendar";

export type CalendarInviteActionType = "invitation" | "update" | "cancellation";
export type CalendarInviteUnprocessedReason = "event_series_not_found";

export type CalendarInviteMutationGroup = {
  eventUid: string;
  canceledWhole: boolean;
  hasCancellation: boolean;
  baseEvent: CalendarEventPreview | null;
  addedRecurrenceDates: number[];
  addedExcludedDates: number[];
  instanceOccurrences: Array<{ startAtMs: number; endAtMs?: number; recurrenceIdAtMs: number }>;
  hasInstanceChanges: boolean;
  sequence: number;
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
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.round(timestamp) : Number.NaN;
}

export function inferCalendarInviteActionType(
  group: CalendarInviteMutationGroup,
  options?: { hasExistingEvent?: boolean }
): CalendarInviteActionType {
  if (group.canceledWhole) return "cancellation";
  if (options?.hasExistingEvent || group.hasInstanceChanges || group.sequence > 0) {
    return "update";
  }
  return "invitation";
}

export function inferCalendarInviteMessageActionType(
  group: CalendarInviteMutationGroup
): CalendarInviteActionType {
  if (group.hasCancellation) return "cancellation";
  if (group.hasInstanceChanges || group.sequence > 0) return "update";
  return "invitation";
}

export function collectCalendarInviteMutationGroups(icsSource: string): CalendarInviteMutationGroup[] {
  const parsed = parseIcsInvite(icsSource);
  const method = parsed.method?.trim().toUpperCase() || "";
  if (method === "REPLY") return [];
  const groupsByUid = new Map<string, CalendarInviteMutationGroup>();

  const getGroup = (eventUid: string) => {
    let group = groupsByUid.get(eventUid);
    if (group) return group;
    group = {
      eventUid,
      canceledWhole: false,
      hasCancellation: false,
      baseEvent: null,
      addedRecurrenceDates: [],
      addedExcludedDates: [],
      instanceOccurrences: [],
      hasInstanceChanges: false,
      sequence: 0
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
    const sequence =
      typeof event.sequence === "number" && Number.isFinite(event.sequence) ? event.sequence : 0;
    if (sequence > group.sequence) {
      group.sequence = sequence;
    }

    if (cancelled) {
      group.hasCancellation = true;
      if (hasRecurrenceId) {
        group.addedExcludedDates.push(recurrenceIdAtMs);
        group.hasInstanceChanges = true;
        return;
      }
      group.canceledWhole = true;
      return;
    }

    const eventStartAtMs = asTimestampMs(event.start);
    if (!Number.isFinite(eventStartAtMs)) {
      if (hasRecurrenceId) {
        group.addedExcludedDates.push(recurrenceIdAtMs);
        group.hasInstanceChanges = true;
      }
      return;
    }

    if (hasRecurrenceId) {
      const eventEndAtMs = asTimestampMs(event.end);
      group.addedExcludedDates.push(recurrenceIdAtMs);
      group.addedRecurrenceDates.push(eventStartAtMs);
      group.instanceOccurrences.push({
        startAtMs: eventStartAtMs,
        endAtMs:
          Number.isFinite(eventEndAtMs) && eventEndAtMs > eventStartAtMs
            ? eventEndAtMs
            : undefined,
        recurrenceIdAtMs
      });
      group.hasInstanceChanges = true;
      return;
    }

    group.baseEvent = event;
  });

  return Array.from(groupsByUid.values()).map((group) => ({
    ...group,
    addedRecurrenceDates: normalizeDateList(group.addedRecurrenceDates) ?? [],
    addedExcludedDates: normalizeDateList(group.addedExcludedDates) ?? []
  }));
}
