import type { CalendarEvent, CalendarReminder } from "./data";
import { listRecurrenceOccurrenceStartsInRange } from "./reminderRecurrence";

export type CalendarEventOccurrence = {
  event: CalendarEvent;
  displayStartAtMs: number;
  displayEndAtMs?: number;
};

function normalizeEventUid(value?: string) {
  return value?.trim().toLowerCase() || "";
}

function buildOccurrenceEndAtMs(event: Pick<CalendarEvent, "startAtMs" | "endAtMs">, occurrenceStartAtMs: number) {
  if (typeof event.endAtMs !== "number" || !Number.isFinite(event.endAtMs)) {
    return undefined;
  }
  const durationMs = event.endAtMs - event.startAtMs;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return undefined;
  }
  return occurrenceStartAtMs + durationMs;
}

export function expandCalendarEventForRange(
  event: CalendarEvent,
  rangeStartMs: number,
  rangeEndMs: number
): CalendarEventOccurrence[] {
  if (!event.recurrenceRule?.trim()) {
    return [
      {
        event,
        displayStartAtMs: event.startAtMs,
        displayEndAtMs: event.endAtMs
      }
    ];
  }

  const occurrenceStarts = listRecurrenceOccurrenceStartsInRange(
    {
      eventStartAtMs: event.startAtMs,
      eventEndAtMs: event.endAtMs,
      recurrenceRule: event.recurrenceRule,
      recurrenceDates: event.recurrenceDates,
      excludedDates: event.excludedDates,
      startTimezone: event.startTimezone
    },
    rangeStartMs,
    rangeEndMs
  );

  return occurrenceStarts.map((startAtMs) => ({
    event,
    displayStartAtMs: startAtMs,
    displayEndAtMs: buildOccurrenceEndAtMs(event, startAtMs)
  }));
}

export function filterCalendarReminderDuplicates(
  reminders: CalendarReminder[],
  visibleEvents: CalendarEventOccurrence[]
): CalendarReminder[] {
  const visibleEventUids = new Set(
    visibleEvents
      .map(({ event }) => normalizeEventUid(event.eventUid))
      .filter(Boolean)
  );
  if (visibleEventUids.size === 0) {
    return reminders;
  }
  return reminders.filter((reminder) => {
    const reminderUid = normalizeEventUid(reminder.eventUid);
    return !reminderUid || !visibleEventUids.has(reminderUid);
  });
}
