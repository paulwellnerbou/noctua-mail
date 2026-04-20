import { useState } from "react";
import { buildAccountCalendarEventPath } from "@/lib/accountApiPaths";
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
 * occurrence scope, non-recurring events delete directly. Occurrence deletes
 * add an exclusion date; series deletes issue a soft-delete. Either path
 * broadcasts the calendar/reminder update events and invokes onEventDeleted.
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
      if (scope === "occurrence") {
        if (resolvedOccurrenceStartAtMs === undefined) {
          onNotice("Failed to delete occurrence.");
          return;
        }
        const response = await fetch(buildAccountCalendarEventPath(accountId, eventId), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            excludedDates: buildOccurrenceExcludedDates(
              eventSnapshot.excludedDates,
              resolvedOccurrenceStartAtMs
            )
          })
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              ok?: boolean;
              event?: CalendarEvent;
              message?: string;
            }
          | null;
        if (!response.ok || payload?.ok !== true || !payload.event) {
          onNotice(payload?.message ?? "Failed to delete occurrence.");
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
      onNotice(scope === "occurrence" ? "Failed to delete occurrence." : "Failed to delete event.");
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
