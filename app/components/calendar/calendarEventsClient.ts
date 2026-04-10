"use client";

export const CALENDAR_EVENTS_UPDATED_EVENT = "noctua:calendar-events-updated";

export function dispatchCalendarEventsUpdatedEvent() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CALENDAR_EVENTS_UPDATED_EVENT));
}
