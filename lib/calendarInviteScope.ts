import type { CalendarEventPreview } from "./calendar";
import type { CalendarInviteMutationGroup } from "./calendarInviteProcessing";
import type { CalendarEvent } from "./data";

export type CalendarInviteScope = "single-event" | "series" | "one-occurrence" | "multiple-occurrences";

export type CalendarInviteScopeInfo = {
  scope: CalendarInviteScope;
  label: string;
};

const SCOPE_LABELS: Record<CalendarInviteScope, string> = {
  "single-event": "Single event",
  series: "Series",
  "one-occurrence": "One occurrence",
  "multiple-occurrences": "Multiple occurrences"
};

function hasRecurrenceDefinition(
  event: Pick<CalendarEventPreview, "recurrenceRule" | "recurrenceDates" | "excludedDates">
) {
  return Boolean(
    event.recurrenceRule?.trim() ||
      (event.recurrenceDates?.length ?? 0) > 0 ||
      (event.excludedDates?.length ?? 0) > 0
  );
}

function hasStoredRecurrenceDefinition(
  event?: Pick<CalendarEvent, "recurrenceRule" | "recurrenceDates" | "excludedDates"> | null
) {
  if (!event) return false;
  return Boolean(
    event.recurrenceRule?.trim() ||
      (event.recurrenceDates?.length ?? 0) > 0 ||
      (event.excludedDates?.length ?? 0) > 0
  );
}

function countInstanceTargets(group?: Pick<CalendarInviteMutationGroup, "addedExcludedDates"> | null) {
  if (!group) return 0;
  return new Set(
    group.addedExcludedDates
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.round(value))
  ).size;
}

export function getCalendarInviteScopeInfo({
  event,
  mutationGroup,
  storedEvent
}: {
  event: CalendarEventPreview;
  mutationGroup?: CalendarInviteMutationGroup | null;
  storedEvent?: Pick<CalendarEvent, "recurrenceRule" | "recurrenceDates" | "excludedDates"> | null;
}): CalendarInviteScopeInfo {
  const hasRecurrenceId = Boolean(event.recurrenceId);
  if (hasRecurrenceId) {
    const recurrenceRange = event.recurrenceIdRange?.trim().toUpperCase();
    const scope: CalendarInviteScope =
      recurrenceRange === "THISANDFUTURE" || countInstanceTargets(mutationGroup) > 1
        ? "multiple-occurrences"
        : "one-occurrence";
    return { scope, label: SCOPE_LABELS[scope] };
  }

  const scope: CalendarInviteScope =
    hasRecurrenceDefinition(event) || hasStoredRecurrenceDefinition(storedEvent)
      ? "series"
      : "single-event";
  return { scope, label: SCOPE_LABELS[scope] };
}
