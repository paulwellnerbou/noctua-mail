import { useState } from "react";
import { buildAccountCalendarEventPath } from "@/lib/accountApiPaths";
import { truncateRecurrenceBeforeOccurrence } from "@/lib/calendarSeriesTruncation";
import type { CalendarEvent } from "@/lib/data";
import { dispatchCalendarRemindersUpdatedEvent } from "@/app/components/mailclient/utils/calendarReminders";
import { dispatchCalendarEventsUpdatedEvent } from "./calendarEventsClient";
import type { CalendarEventDeleteAction, CalendarEventDeleteScope } from "./EventDetailView";

export type UseEventDeleteStateInput = {
  accountId: string;
  eventId?: string;
  eventSnapshot?: CalendarEvent;
  recurrenceRule?: string;
  resolvedOccurrenceStartAtMs?: number;
  onEventDeleted?: (action: CalendarEventDeleteAction) => void;
  onNotice: (message: string) => void;
};

export type UseEventDeleteStateResult = {
  deletingEvent: boolean;
  deleteScopeDialogOpen: boolean;
  setDeleteScopeDialogOpen: (open: boolean) => void;
  handleDeleteEvent: () => void;
  performDeleteEvent: (scope: CalendarEventDeleteScope) => Promise<void>;
};

const FAILURE_MESSAGES: Record<CalendarEventDeleteScope, string> = {
  occurrence: "Failed to delete occurrence.",
  following: "Failed to delete following occurrences.",
  series: "Failed to delete event."
};

function buildOccurrenceExcludedDates(excludedDates: number[] | undefined, occurrenceStartAtMs: number) {
  return Array.from(
    new Set(
      [...(excludedDates ?? []), occurrenceStartAtMs]
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.round(value))
    )
  ).sort((left, right) => left - right);
}

/**
 * Owns the event deletion flow: recurring events prompt for series vs.
 * occurrence vs. this-and-following scope, non-recurring events delete directly.
 * Occurrence deletes add an exclusion date; following deletes cap the series
 * with UNTIL; series deletes issue a soft-delete. Every path broadcasts the
 * calendar/reminder update events and invokes onEventDeleted.
 */
export function useEventDeleteState({
  accountId,
  eventId,
  eventSnapshot,
  recurrenceRule,
  resolvedOccurrenceStartAtMs,
  onEventDeleted,
  onNotice
}: UseEventDeleteStateInput): UseEventDeleteStateResult {
  const [deletingEvent, setDeletingEvent] = useState(false);
  const [deleteScopeDialogOpen, setDeleteScopeDialogOpen] = useState(false);

  const canChooseDeleteScope =
    Boolean(eventSnapshot) &&
    Boolean(recurrenceRule?.trim()) &&
    resolvedOccurrenceStartAtMs !== undefined;

  const performDeleteEvent = async (scope: CalendarEventDeleteScope) => {
    if (!accountId || !eventId || !eventSnapshot) return;
    setDeletingEvent(true);
    setDeleteScopeDialogOpen(false);
    try {
      if (scope === "occurrence" || scope === "following") {
        if (resolvedOccurrenceStartAtMs === undefined) {
          onNotice(FAILURE_MESSAGES[scope]);
          return;
        }
        const body =
          scope === "occurrence"
            ? {
                excludedDates: buildOccurrenceExcludedDates(
                  eventSnapshot.excludedDates,
                  resolvedOccurrenceStartAtMs
                )
              }
            : (() => {
                const truncated = truncateRecurrenceBeforeOccurrence(
                  eventSnapshot,
                  resolvedOccurrenceStartAtMs
                );
                return {
                  recurrenceRule: truncated.recurrenceRule,
                  recurrenceDates: truncated.recurrenceDates ?? [],
                  excludedDates: truncated.excludedDates ?? []
                };
              })();
        const response = await fetch(buildAccountCalendarEventPath(accountId, eventId), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              ok?: boolean;
              event?: CalendarEvent;
              message?: string;
            }
          | null;
        if (!response.ok || payload?.ok !== true || !payload.event) {
          onNotice(payload?.message ?? FAILURE_MESSAGES[scope]);
          return;
        }
        dispatchCalendarEventsUpdatedEvent();
        dispatchCalendarRemindersUpdatedEvent();
        onEventDeleted?.({
          event: eventSnapshot,
          scope,
          occurrenceStartAtMs: resolvedOccurrenceStartAtMs
        });
        return;
      }

      const params = new URLSearchParams({ soft: "true" });
      const response = await fetch(buildAccountCalendarEventPath(accountId, eventId, params), {
        method: "DELETE"
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            message?: string;
          }
        | null;
      if (!response.ok || payload?.ok !== true) {
        onNotice(payload?.message ?? "Failed to delete event.");
        return;
      }
      dispatchCalendarEventsUpdatedEvent();
      dispatchCalendarRemindersUpdatedEvent();
      onEventDeleted?.({
        event: eventSnapshot,
        scope
      });
    } catch {
      onNotice(FAILURE_MESSAGES[scope]);
    } finally {
      setDeletingEvent(false);
    }
  };

  const handleDeleteEvent = () => {
    if (canChooseDeleteScope) {
      setDeleteScopeDialogOpen(true);
      return;
    }
    void performDeleteEvent("series");
  };

  return {
    deletingEvent,
    deleteScopeDialogOpen,
    setDeleteScopeDialogOpen,
    handleDeleteEvent,
    performDeleteEvent
  };
}
