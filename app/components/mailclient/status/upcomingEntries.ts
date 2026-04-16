import type { CalendarEvent } from "@/lib/data";
import {
  getCalendarReminderStartAtMs,
  type CalendarReminder
} from "../utils/calendarReminders";

/**
 * Default upcoming-event window: 4 weeks ahead of "now".
 * Reminders outside this window still show if they trigger inside the list.
 */
export const DEFAULT_UPCOMING_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;

/** Default cap on how many rows the popover renders. */
export const DEFAULT_UPCOMING_CAP = 10;

/**
 * Unified row shown in the "Upcoming" popover.
 *
 * - Entries backed by a calendar event carry `event`.
 * - Entries backed by a reminder carry `reminder`.
 * - Merged entries (reminder bound to an event inside the window) carry both.
 */
export type UpcomingEntry = {
  /**
   * Stable key for list rendering. Prefers event UID, falls back to reminder id.
   */
  key: string;
  /** Milliseconds since epoch for chronological sort. */
  startAtMs: number;
  /** Matching end time, if known. */
  endAtMs?: number;
  /** Display title — event summary if present, else reminder event title. */
  title: string;
  /** IANA timezone hint for formatting. */
  timeZone?: string;
  /** Display location, if any. */
  location?: string;
  /** Underlying event, when this row represents (or merges) a calendar event. */
  event?: CalendarEvent;
  /** Underlying reminder, when this row has a reminder attached. */
  reminder?: CalendarReminder;
  /**
   * MessageId used for the click-to-open-source-mail target. Prefers the
   * reminder's messageId, falls back to the event's messageId.
   */
  messageId?: string;
};

function normalizeEventUid(value: string | undefined) {
  return value?.trim().toLowerCase() || "";
}

/**
 * Merge `events` (within the 4-week window) with `reminders` chronologically.
 *
 * Dedupe rule: if a reminder shares `eventUid` with an event in the window,
 * the two collapse to a single entry rendered as the event with the
 * reminder's lead label attached. Reminders whose event is outside the
 * window stay as their own entry.
 *
 * The merged list is sorted by `startAtMs` ascending and truncated to
 * `capAt` rows (default 10). Pre-cap length is the true merged count.
 */
export function buildUpcomingEntries(
  events: CalendarEvent[],
  reminders: CalendarReminder[],
  options?: {
    nowMs?: number;
    windowMs?: number;
    capAt?: number;
  }
): { entries: UpcomingEntry[]; mergedCount: number } {
  const nowMs = options?.nowMs ?? Date.now();
  const windowMs = options?.windowMs ?? DEFAULT_UPCOMING_WINDOW_MS;
  const capAt = options?.capAt ?? DEFAULT_UPCOMING_CAP;
  const endBoundMs = nowMs + windowMs;

  // Filter + build event entries, keyed by normalized eventUid so
  // reminders can attach.
  const eventEntriesByUid = new Map<string, UpcomingEntry>();
  const eventEntries: UpcomingEntry[] = [];

  events.forEach((event) => {
    if (!Number.isFinite(event.startAtMs)) return;
    if (event.startAtMs < nowMs || event.startAtMs > endBoundMs) return;
    const entry: UpcomingEntry = {
      key: `event:${event.id || event.eventUid}`,
      startAtMs: event.startAtMs,
      endAtMs: Number.isFinite(event.endAtMs ?? Number.NaN) ? event.endAtMs : undefined,
      title: event.summary || "Calendar event",
      timeZone: event.startTimezone,
      location: event.location,
      event,
      messageId: event.messageId
    };
    eventEntries.push(entry);
    const uid = normalizeEventUid(event.eventUid);
    if (uid) {
      eventEntriesByUid.set(uid, entry);
    }
  });

  // Walk reminders and either attach to the matching event entry or add as
  // a standalone entry.
  const reminderOnlyEntries: UpcomingEntry[] = [];
  reminders.forEach((reminder) => {
    const uid = normalizeEventUid(reminder.eventUid);
    const matchingEventEntry = uid ? eventEntriesByUid.get(uid) : undefined;
    if (matchingEventEntry) {
      matchingEventEntry.reminder = reminder;
      // Prefer reminder.messageId if the event didn't carry one.
      if (!matchingEventEntry.messageId && reminder.messageId) {
        matchingEventEntry.messageId = reminder.messageId;
      }
      return;
    }
    const startAtMs = getCalendarReminderStartAtMs(reminder);
    if (!Number.isFinite(startAtMs)) return;
    reminderOnlyEntries.push({
      key: `reminder:${reminder.id}`,
      startAtMs,
      endAtMs:
        typeof reminder.eventEndAtMs === "number" && Number.isFinite(reminder.eventEndAtMs)
          ? reminder.eventEndAtMs
          : undefined,
      title: reminder.eventTitle || "Calendar event",
      timeZone: reminder.startTimezone,
      location: reminder.eventLocation,
      reminder,
      messageId: reminder.messageId
    });
  });

  const merged = [...eventEntries, ...reminderOnlyEntries].sort(
    (a, b) => a.startAtMs - b.startAtMs
  );

  return {
    entries: merged.slice(0, Math.max(0, capAt)),
    mergedCount: merged.length
  };
}
