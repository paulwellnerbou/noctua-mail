"use client";

export const CALENDAR_EVENTS_UPDATED_EVENT = "noctua:calendar-events-updated";

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
