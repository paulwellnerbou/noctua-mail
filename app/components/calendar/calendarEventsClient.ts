"use client";

import type { CalendarEvent } from "@/lib/data";
import { buildAccountCalendarEventPath } from "@/lib/accountApiPaths";

export const CALENDAR_EVENTS_UPDATED_EVENT = "noctua:calendar-events-updated";

/**
 * Full row for one event. The range listing leaves out the raw ICS and the
 * source email snapshot; anything that shows those loads the event here.
 * Resolves to null when the event is gone or the request fails.
 */
export async function fetchCalendarEventById(
  accountId: string,
  eventId: string
): Promise<CalendarEvent | null> {
  try {
    const res = await fetch(buildAccountCalendarEventPath(accountId, eventId));
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; event?: CalendarEvent | null };
    return data.ok && data.event ? data.event : null;
  } catch {
    return null;
  }
}

export function dispatchCalendarEventsUpdatedEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CALENDAR_EVENTS_UPDATED_EVENT));
}

// Fired after a CalDAV sync round-trip settles. Distinct from the
// "events-updated" signal (which drives the sync) so listeners that react to
// *server* state — e.g. the write-back conflict banner — can refresh without
// re-triggering another sync and looping.
export const CALENDAR_SYNC_COMPLETED_EVENT = "noctua:calendar-sync-completed";

export function dispatchCalendarSyncCompletedEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CALENDAR_SYNC_COMPLETED_EVENT));
}
