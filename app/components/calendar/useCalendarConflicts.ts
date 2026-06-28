"use client";

import { useCallback, useEffect, useState } from "react";
import type { CalendarEventDiff } from "@/lib/calendarEventDiff";
import { buildAccountCalendarConflictsPath } from "@/lib/accountApiPaths";
import {
  CALENDAR_EVENTS_UPDATED_EVENT,
  CALENDAR_SYNC_COMPLETED_EVENT
} from "./calendarEventsClient";

export type CalendarEventConflictItem = {
  eventId: string;
  eventUid: string;
  summary: string | null;
  timeZone: string | null;
  allDay: boolean;
  localChangedAtMs: number | null;
  remoteChangedAtMs: number | null;
  localDiff: CalendarEventDiff | null;
  remoteDiff: CalendarEventDiff | null;
};

/**
 * Loads unresolved CalDAV write-back conflicts for the account and keeps them
 * fresh: it re-fetches on local mutations (resolve/edit) and after each sync
 * round-trip settles, since that is when the server may have recorded a new
 * conflict.
 */
export function useCalendarConflicts(accountId: string) {
  const [conflicts, setConflicts] = useState<CalendarEventConflictItem[]>([]);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    try {
      const res = await fetch(buildAccountCalendarConflictsPath(accountId), {
        credentials: "include"
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        ok?: boolean;
        conflicts?: CalendarEventConflictItem[];
      };
      if (body.ok) setConflicts(body.conflicts ?? []);
    } catch {
      // transient; next signal refreshes
    }
  }, [accountId]);

  useEffect(() => {
    void refresh();
    const handler = () => void refresh();
    window.addEventListener(CALENDAR_EVENTS_UPDATED_EVENT, handler);
    window.addEventListener(CALENDAR_SYNC_COMPLETED_EVENT, handler);
    return () => {
      window.removeEventListener(CALENDAR_EVENTS_UPDATED_EVENT, handler);
      window.removeEventListener(CALENDAR_SYNC_COMPLETED_EVENT, handler);
    };
  }, [refresh]);

  return { conflicts, refresh };
}
