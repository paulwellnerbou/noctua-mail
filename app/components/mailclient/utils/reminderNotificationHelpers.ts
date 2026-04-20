/**
 * Pure helpers for shaping calendar reminder notifications.
 *
 * useReminderNotifications orchestrates service-worker registration, fetch,
 * permission prompts, and timers. The small shape-only decisions — which
 * reminders are still in the future, which are due and not yet delivered,
 * and how the notification body reads — live here so they can be tested
 * without a DOM.
 */
import type { CalendarReminder } from "@/lib/data";
import { getCalendarReminderEndAtMs } from "./calendarReminders";

/**
 * Keep reminders whose underlying event has not already ended.
 */
export function filterUpcomingCalendarReminders(
  reminders: CalendarReminder[],
  nowMs: number = Date.now()
): CalendarReminder[] {
  return reminders.filter((reminder) => getCalendarReminderEndAtMs(reminder) > nowMs);
}

/**
 * Pick the reminders whose trigger time has passed, whose event has not yet
 * ended, and which have not already been delivered on this client. The
 * delivery check is injected so callers control how the per-account dedup
 * store is queried.
 */
export function selectDueUndeliveredReminders(
  reminders: CalendarReminder[],
  nowMs: number,
  isDelivered: (reminder: CalendarReminder) => boolean
): CalendarReminder[] {
  return reminders.filter((reminder) => {
    if (reminder.triggerAtMs > nowMs) return false;
    if (getCalendarReminderEndAtMs(reminder) <= nowMs) return false;
    if (isDelivered(reminder)) return false;
    return true;
  });
}

/**
 * Build the dot-separated body string used for calendar reminder
 * notifications. Location is appended only when present.
 */
export function buildReminderNotificationBody(
  reminder: CalendarReminder,
  eventDateLabel: string
): string {
  const bodyParts = [`${reminder.leadLabel} reminder`, `Starts ${eventDateLabel}`];
  if (reminder.eventLocation) {
    bodyParts.push(reminder.eventLocation);
  }
  return bodyParts.join(" \u00b7 ");
}

export type ReminderServiceWorkerPayload = {
  type: "noctua:reminder-state";
  accountIds: string[];
  deliveredByAccount: Record<string, Record<string, number>>;
  activeAccountId: string | null;
  activeReminderIds: string[];
};

/**
 * Shape the message sent to the service worker when the set of pending
 * reminders changes. Accounts with an empty delivered map are omitted to
 * keep the payload compact.
 */
export function buildReminderServiceWorkerPayload(
  accountIds: string[],
  activeAccountId: string,
  reminders: CalendarReminder[],
  readDeliveredMap: (accountId: string) => Record<string, number>
): ReminderServiceWorkerPayload {
  const deliveredByAccount: Record<string, Record<string, number>> = {};
  accountIds.forEach((accountId) => {
    const map = readDeliveredMap(accountId);
    if (Object.keys(map).length > 0) {
      deliveredByAccount[accountId] = map;
    }
  });
  return {
    type: "noctua:reminder-state",
    accountIds,
    deliveredByAccount,
    activeAccountId: activeAccountId || null,
    activeReminderIds: reminders.map((item) => item.id)
  };
}
