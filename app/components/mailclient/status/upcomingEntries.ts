import type { CalendarEvent } from "@/lib/data";
import {
  getCalendarReminderEndAtMs,
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
   * MessageId used for the click-to-open-source-mail target. When an event is
   * present its `messageId` wins; reminder's `messageId` is only used as a
   * fallback (or on reminder-only rows).
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

  // Filter + build event entries. Keyed by normalized eventUid so reminders
  // can attach; we keep an array per uid to support recurring series where
  // multiple occurrences share the same uid but land on different dates.
  const eventEntriesByUid = new Map<string, UpcomingEntry[]>();
  const eventEntries: UpcomingEntry[] = [];

  events.forEach((event) => {
    if (!Number.isFinite(event.startAtMs)) return;
    if (event.startAtMs < nowMs || event.startAtMs > endBoundMs) return;
    const entry: UpcomingEntry = {
      // Include startAtMs in the key so recurring occurrences (same uid,
      // different date) don't collide during React reconciliation.
      key: `event:${event.id || event.eventUid}:${event.startAtMs}`,
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
      const existing = eventEntriesByUid.get(uid);
      if (existing) {
        existing.push(entry);
      } else {
        eventEntriesByUid.set(uid, [entry]);
      }
    }
  });

  // Walk reminders and either attach to the matching event entry (matching
  // the specific occurrence by start time for recurring series) or add as a
  // standalone entry.
  const reminderOnlyEntries: UpcomingEntry[] = [];
  reminders.forEach((reminder) => {
    const uid = normalizeEventUid(reminder.eventUid);
    const candidates = uid ? eventEntriesByUid.get(uid) : undefined;
    const reminderStartAtMs = getCalendarReminderStartAtMs(reminder);
    let matchingEventEntry: UpcomingEntry | undefined;
    if (candidates && candidates.length > 0) {
      if (Number.isFinite(reminderStartAtMs)) {
        matchingEventEntry = candidates.find(
          (entry) => entry.startAtMs === reminderStartAtMs
        );
      }
      // If the reminder's occurrence isn't in the window, attach to the
      // earliest candidate so at least the lead label is surfaced.
      if (!matchingEventEntry && candidates.length === 1) {
        matchingEventEntry = candidates[0];
      }
    }
    if (matchingEventEntry) {
      matchingEventEntry.reminder = reminder;
      // Prefer reminder.messageId if the event didn't carry one.
      if (!matchingEventEntry.messageId && reminder.messageId) {
        matchingEventEntry.messageId = reminder.messageId;
      }
      return;
    }
    if (!Number.isFinite(reminderStartAtMs)) return;
    const reminderEndAtMs = getCalendarReminderEndAtMs(reminder);
    reminderOnlyEntries.push({
      key: `reminder:${reminder.id}`,
      startAtMs: reminderStartAtMs,
      endAtMs:
        Number.isFinite(reminderEndAtMs) && reminderEndAtMs > reminderStartAtMs
          ? reminderEndAtMs
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
