"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  // Monotonic token: every refresh claims one; a response only applies if it's
  // still the latest. Bumped on cleanup so an in-flight fetch can't update state
  // after an account switch or unmount (stale data / setState-after-unmount).
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    const token = ++requestRef.current;
    try {
      const res = await fetch(buildAccountCalendarConflictsPath(accountId), {
        credentials: "include"
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        ok?: boolean;
        conflicts?: CalendarEventConflictItem[];
      };
      if (token !== requestRef.current) return; // superseded or unmounted
      if (body.ok) setConflicts(body.conflicts ?? []);
    } catch {
      // transient; next signal refreshes
    }
  }, [accountId]);

  useEffect(() => {
    // Drop the previous account's conflicts immediately on switch so the banner
    // can't show the wrong account's data while the new fetch is in flight.
    setConflicts([]);
    void refresh();
    const handler = () => void refresh();
    window.addEventListener(CALENDAR_EVENTS_UPDATED_EVENT, handler);
    window.addEventListener(CALENDAR_SYNC_COMPLETED_EVENT, handler);
    return () => {
      requestRef.current++; // invalidate any in-flight refresh
      window.removeEventListener(CALENDAR_EVENTS_UPDATED_EVENT, handler);
      window.removeEventListener(CALENDAR_SYNC_COMPLETED_EVENT, handler);
    };
  }, [refresh]);

  return { conflicts, refresh };
}
