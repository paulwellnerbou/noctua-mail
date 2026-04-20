import { useCallback, useEffect, useState } from "react";
import type { AccountDateFormat } from "@/lib/data";
import { formatAccountMediumDateTime } from "@/lib/dateFormatting";
import { resolveNextReminderOccurrence } from "@/lib/reminderRecurrence";
import {
  CALENDAR_REMINDER_LEAD_OPTIONS,
  deleteCalendarReminder,
  fetchCalendarReminders,
  findActiveCalendarReminderForEvent,
  getCalendarReminderLeadOption,
  upsertCalendarReminder,
  type CalendarReminder
} from "@/app/components/mailclient/utils/calendarReminders";

export type UseEventReminderStateInput = {
  accountId: string;
  eventUid?: string;
  title: string;
  location?: string;
  description?: string;
  messageId?: string;
  startTimezone?: string;
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
  canonicalStartMs?: number;
  eventEndAtMs?: number;
  dateFormat?: AccountDateFormat;
  onNotice: (message: string) => void;
};

export type UseEventReminderStateResult = {
  existingReminder: CalendarReminder | null;
  reminderModalOpen: boolean;
  setReminderModalOpen: (open: boolean) => void;
  leadOptionValue: string;
  setLeadOptionValue: (value: string) => void;
  savingReminder: boolean;
  deletingReminder: boolean;
  canScheduleReminder: boolean;
  handleScheduleReminder: () => Promise<void>;
  handleDeleteReminder: () => Promise<void>;
};

function formatTriggerDate(date: Date, dateFormat?: AccountDateFormat) {
  return formatAccountMediumDateTime(date.getTime(), dateFormat) ?? "";
}

/**
 * Owns the reminder lifecycle for a single event: discovering an existing
 * reminder on mount, persisting new ones, and removing them. Surface status
 * messages flow to the caller via `onNotice` so the view layer can decide
 * where to display them.
 */
export function useEventReminderState({
  accountId,
  eventUid,
  title,
  location,
  description,
  messageId,
  startTimezone,
  recurrenceRule,
  recurrenceDates,
  excludedDates,
  canonicalStartMs,
  eventEndAtMs,
  dateFormat,
  onNotice
}: UseEventReminderStateInput): UseEventReminderStateResult {
  const [existingReminder, setExistingReminder] = useState<CalendarReminder | null>(null);
  const [reminderModalOpen, setReminderModalOpen] = useState(false);
  const [leadOptionValue, setLeadOptionValue] = useState(CALENDAR_REMINDER_LEAD_OPTIONS[3]?.value ?? "15");
  const [savingReminder, setSavingReminder] = useState(false);
  const [deletingReminder, setDeletingReminder] = useState(false);

  const canScheduleReminder = (() => {
    if (!canonicalStartMs) return false;
    const nowMs = Date.now();
    if (!recurrenceRule?.trim()) return canonicalStartMs > nowMs;
    const next = resolveNextReminderOccurrence({
      eventStartAtMs: canonicalStartMs,
      eventEndAtMs: eventEndAtMs,
      leadMinutes: 0,
      recurrenceRule,
      recurrenceDates,
      excludedDates
    }, nowMs);
    return Boolean(next && next.eventStartAtMs > nowMs);
  })();

  const refreshReminder = useCallback(async () => {
    if (!accountId || !canonicalStartMs) return;
    try {
      const reminders = await fetchCalendarReminders(accountId);
      const found = findActiveCalendarReminderForEvent(reminders, {
        eventUid,
        eventTitle: title,
        eventStartAtMs: canonicalStartMs
      });
      setExistingReminder(found);
      if (found) {
        const val = String(found.leadMinutes);
        const has = CALENDAR_REMINDER_LEAD_OPTIONS.some((o) => o.value === val);
        setLeadOptionValue(has ? val : (CALENDAR_REMINDER_LEAD_OPTIONS[3]?.value ?? "15"));
      }
    } catch {
      // ignore
    }
  }, [accountId, eventUid, title, canonicalStartMs]);

  useEffect(() => { void refreshReminder(); }, [refreshReminder]);

  const handleScheduleReminder = async () => {
    if (!accountId || !canonicalStartMs) return;
    setSavingReminder(true);
    try {
      const option = getCalendarReminderLeadOption(leadOptionValue);
      const stored = await upsertCalendarReminder(accountId, {
        eventUid,
        eventTitle: title,
        eventLocation: location,
        eventDescription: description,
        eventStartAtMs: canonicalStartMs,
        eventEndAtMs: eventEndAtMs,
        messageId,
        startTimezone,
        recurrenceRule,
        recurrenceDates,
        excludedDates,
        leadMinutes: option.minutes,
        leadLabel: option.label
      });
      const triggerDate = new Date(stored.reminder.triggerAtMs > Date.now() ? stored.reminder.triggerAtMs : Date.now());
      onNotice(
        stored.replaced
          ? `Reminder updated for ${formatTriggerDate(triggerDate, dateFormat)}.`
          : `Reminder scheduled for ${formatTriggerDate(triggerDate, dateFormat)}.`
      );
      setReminderModalOpen(false);
      await refreshReminder();
    } catch {
      onNotice("Failed to save reminder.");
    } finally {
      setSavingReminder(false);
    }
  };

  const handleDeleteReminder = async () => {
    if (!accountId || !existingReminder) return;
    setDeletingReminder(true);
    try {
      await deleteCalendarReminder(accountId, existingReminder.id);
      setExistingReminder(null);
      onNotice("Reminder removed.");
    } catch {
      onNotice("Failed to remove reminder.");
    } finally {
      setDeletingReminder(false);
    }
  };

  return {
    existingReminder,
    reminderModalOpen,
    setReminderModalOpen,
    leadOptionValue,
    setLeadOptionValue,
    savingReminder,
    deletingReminder,
    canScheduleReminder,
    handleScheduleReminder,
    handleDeleteReminder
  };
}
