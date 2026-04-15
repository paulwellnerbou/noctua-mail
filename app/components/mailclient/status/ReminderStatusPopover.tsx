"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2, X, MapPin, Clock, Repeat, Loader2 } from "lucide-react";
import {
  Badge,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  IconButton,
  Popover,
  Text
} from "@radix-ui/themes";
import { buildCalendarRecurrenceSummary, formatCalendarEventRange } from "@/lib/calendar";
import { formatCalendarTimeZoneShortLabel } from "@/lib/calendarTimezones";
import {
  clearCalendarReminders,
  deleteCalendarReminder,
  getCalendarReminderEndAtMs,
  getCalendarReminderStartAtMs,
  type CalendarReminder
} from "../utils/calendarReminders";
import { groupItemsByRelativeTime } from "../utils/relativeTimeGroups";
import {
  BottomStatusTriggerButton,
  type BottomStatusTone
} from "./BottomStatusSection";

type ReminderStatusPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeAccountId: string;
  pendingCalendarReminders: CalendarReminder[];
  onRefreshPendingReminders: () => Promise<void>;
  onOpenReminderMessage: (messageId: string) => void;
  onReportError: (message: string) => void;
};

function formatEventTimeRange(startAtMs: number, endAtMs: number, timeZone?: string) {
  if (!Number.isFinite(startAtMs)) return "";
  return formatCalendarEventRange(
    new Date(startAtMs),
    Number.isFinite(endAtMs) && endAtMs > startAtMs ? new Date(endAtMs) : undefined,
    { startTimeZone: timeZone }
  );
}

function formatEventDuration(startAtMs: number, endAtMs: number) {
  if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs) || endAtMs <= startAtMs) return "";
  const totalMinutes = Math.round((endAtMs - startAtMs) / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

function formatReminderUid(uid: string) {
  const MAX_UID_DISPLAY_LENGTH = 40;
  const normalizedUid = uid.trim();
  if (normalizedUid.length <= MAX_UID_DISPLAY_LENGTH) return normalizedUid;
  return `${normalizedUid.slice(0, 24)}...${normalizedUid.slice(-13)}`;
}

function formatReminderTimeZoneLabel(eventStartAtMs: number, timeZone?: string) {
  if (!Number.isFinite(eventStartAtMs)) return "";
  return formatCalendarTimeZoneShortLabel(timeZone, new Date(eventStartAtMs));
}

const REMINDER_NOTICE_TIMEOUT_MS = 3600;

function buildReminderRecurrenceSummary(reminder: CalendarReminder) {
  if (!reminder.recurrenceRule?.trim()) return null;
  const startAtMs = getCalendarReminderStartAtMs(reminder);
  if (!Number.isFinite(startAtMs)) return null;
  return buildCalendarRecurrenceSummary({
    allDay: false,
    start: new Date(startAtMs),
    startTimezone: reminder.startTimezone,
    recurrenceRule: reminder.recurrenceRule,
    recurrenceDates: reminder.recurrenceDates?.map((value) => new Date(value)),
    excludedDates: reminder.excludedDates?.map((value) => new Date(value))
  });
}

export default function ReminderStatusPopover({
  open,
  onOpenChange,
  activeAccountId,
  pendingCalendarReminders,
  onRefreshPendingReminders,
  onOpenReminderMessage,
  onReportError
}: ReminderStatusPopoverProps) {
  const upcomingReminders = pendingCalendarReminders;
  const nextReminder = upcomingReminders[0] ?? null;
  const reminderCount = upcomingReminders.length;
  const remindersStatusValue = (() => {
    if (!nextReminder) return "None";
    const reminderTitle = nextReminder.eventTitle || "Calendar event";
    const eventStartAtMs = getCalendarReminderStartAtMs(nextReminder);
    const displayAtMs = Number.isFinite(eventStartAtMs) ? eventStartAtMs : nextReminder.triggerAtMs;
    const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(
      new Date(displayAtMs)
    );
    return `${reminderCount} · ${reminderTitle} @ ${time}`;
  })();
  const remindersStatusTone: BottomStatusTone = reminderCount > 0 ? "normal" : "muted";
  const groupedReminders = useMemo(
    () =>
      groupItemsByRelativeTime(
        upcomingReminders,
        (reminder) => getCalendarReminderStartAtMs(reminder)
      ),
    [upcomingReminders]
  );
  const [clearingReminders, setClearingReminders] = useState(false);
  const [deletingReminderIds, setDeletingReminderIds] = useState<Set<string>>(new Set());
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!reminderNotice) return;
    const timer = window.setTimeout(() => {
      setReminderNotice(null);
    }, REMINDER_NOTICE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [reminderNotice]);

  const handleDeleteReminder = useCallback(
    async (reminderId: string) => {
      if (!activeAccountId) return;
      let shouldDelete = false;
      setDeletingReminderIds((prev) => {
        if (prev.has(reminderId)) return prev;
        shouldDelete = true;
        return new Set([...prev, reminderId]);
      });
      if (!shouldDelete) return;
      try {
        await deleteCalendarReminder(activeAccountId, reminderId);
        await onRefreshPendingReminders();
      } catch {
        onReportError("Failed to delete reminder.");
      } finally {
        setDeletingReminderIds((prev) => {
          const next = new Set(prev);
          next.delete(reminderId);
          return next;
        });
      }
    },
    [activeAccountId, onRefreshPendingReminders, onReportError]
  );

  const handleClearReminders = useCallback(async () => {
    if (!activeAccountId.trim()) return;
    setClearingReminders(true);
    try {
      const cleared = await clearCalendarReminders(activeAccountId);
      await onRefreshPendingReminders();
      if (cleared > 0) {
        setReminderNotice(`Cleared ${cleared} reminder${cleared === 1 ? "" : "s"}.`);
      } else {
        setReminderNotice("No reminders to clear.");
      }
    } catch {
      onReportError("Failed to clear reminders.");
    } finally {
      setClearingReminders(false);
    }
  }, [activeAccountId, onRefreshPendingReminders, onReportError]);

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger>
        <BottomStatusTriggerButton
          label="Reminders"
          value={remindersStatusValue}
          tone={remindersStatusTone}
          alignRight
          wide
        />
      </Popover.Trigger>
      <Popover.Content
        className="bottom-popover bottom-popover-reminders"
        side="top"
        align="end"
        sideOffset={8}
      >
        <Flex align="center" justify="between" className="popover-title-row">
          <Flex align="baseline" gap="3">
            <Heading size="3" weight="medium" className="reminder-main-title">
              Reminders
            </Heading>
            <Badge color="gray" variant="soft" radius="full">
              {reminderCount}
            </Badge>
          </Flex>
          <Flex align="center" gap="2">
            <Button
              variant="soft"
              color="gray"
              size="1"
              title="Clear reminder"
              aria-label="Clear reminder"
              disabled={clearingReminders || !activeAccountId.trim()}
              onClick={() => {
                void handleClearReminders();
              }}
            >
              {clearingReminders ? (
                <>
                  <Loader2 size={12} className="reminder-delete-spinner" />
                  Clearing...
                </>
              ) : (
                "Clear reminder"
              )}
            </Button>
            <IconButton
              variant="ghost"
              color="gray"
              size="2"
              title="Close reminders"
              aria-label="Close reminders"
              onClick={() => onOpenChange(false)}
            >
              <X size={16} />
            </IconButton>
          </Flex>
        </Flex>
        <Box className="popover-body">
          {reminderNotice ? (
            <Text as="p" size="1" color="gray" className="reminder-notice">
              {reminderNotice}
            </Text>
          ) : null}
          {upcomingReminders.length > 0 ? (
            <div className="reminder-groups">
              {groupedReminders.map((group) => (
                <section key={group.key} className="reminder-group">
                  <div className="reminder-group-header">
                    <Text size="1" weight="medium" className="reminder-group-label">
                      {group.label}
                    </Text>
                  </div>
                  <div className="reminder-list">
                    {group.items.map((reminder) => {
                      const isDeletingReminder = deletingReminderIds.has(reminder.id);
                      const startAtMs = getCalendarReminderStartAtMs(reminder);
                      const endAtMs = getCalendarReminderEndAtMs(reminder);
                      const timeZoneLabel = formatReminderTimeZoneLabel(
                        startAtMs,
                        reminder.startTimezone
                      );
                      const eventDurationLabel =
                        Number.isFinite(endAtMs) && endAtMs > startAtMs
                          ? formatEventDuration(startAtMs, endAtMs)
                          : "";
                      const eventTimeLabel = formatEventTimeRange(
                        startAtMs,
                        endAtMs,
                        reminder.startTimezone
                      );
                      const recurrenceSummary = buildReminderRecurrenceSummary(reminder);
                      return (
                        <Card
                          key={reminder.id}
                          size="1"
                          className={`reminder-item-card ${isDeletingReminder ? "is-deleting" : ""}`}
                        >
                          <Flex align="start" justify="between" gap="3">
                            <button
                              type="button"
                              className={`reminder-open-button ${reminder.messageId ? "interactive" : ""}`}
                              disabled={isDeletingReminder}
                              onClick={() => {
                                if (!reminder.messageId) {
                                  console.warn("[noctua][reminder-link] missing reminder.messageId", {
                                    reminderId: reminder.id,
                                    eventTitle: reminder.eventTitle
                                    // triggerAtMs: reminder.triggerAtMs
                                  });
                                  return;
                                }
                                onOpenReminderMessage(reminder.messageId);
                                onOpenChange(false);
                              }}
                              title={reminder.messageId ? "Open source mail" : undefined}
                              aria-label={reminder.messageId ? "Open source mail" : undefined}
                            >
                              <Flex direction="column" gap="1" className="reminder-item-main">
                                <Text as="div" size="2" weight="medium" className="reminder-item-title">
                                  {reminder.eventTitle}
                                </Text>
                                {reminder.eventUid ? (
                                  <Text
                                    as="div"
                                    size="1"
                                    color="gray"
                                    className="reminder-uid-label"
                                    title={`UID: ${reminder.eventUid}`}
                                  >
                                    UID: {formatReminderUid(reminder.eventUid)}
                                  </Text>
                                ) : null}
                                <Flex align="center" gap="1" className="reminder-meta-row" wrap="wrap">
                                    <Clock size={12} className="reminder-icon" />
                                    <Text size="1" weight="bold" color="gray" highContrast>
                                        {eventTimeLabel}
                                    </Text>
                                    {timeZoneLabel ? (
                                      <Text size="1" color="gray" className="reminder-timezone-label">
                                        {timeZoneLabel}
                                      </Text>
                                    ) : null}
                                    {eventDurationLabel ? (
                                      <Text size="1" color="gray">
                                        (Duration: {eventDurationLabel})
                                      </Text>
                                    ) : null}
                                    <Text size="1" color="gray">
                                        (Reminder: {reminder.leadLabel} before)
                                    </Text>
                                </Flex>
                                {reminder.eventLocation && (
                                <Flex align="center" gap="1" className="reminder-meta-row">
                                    <MapPin size={12} className="reminder-icon" />
                                    <Text size="1" color="gray">
                                    {reminder.eventLocation}
                                    </Text>
                                </Flex>
                                )}
                                {recurrenceSummary && (
                                <Flex align="center" gap="1" className="reminder-meta-row">
                                    <Repeat size={12} className="reminder-icon" />
                                    <Text size="1" color="gray">
                                    Repeats: {recurrenceSummary}
                                    </Text>
                                </Flex>
                                )}
                              </Flex>
                            </button>
                            <IconButton
                              variant="ghost"
                              color="gray"
                              size="1"
                              title="Delete reminder"
                              aria-label="Delete reminder"
                              className="reminder-delete-btn"
                              disabled={isDeletingReminder}
                              onClick={() => {
                                void handleDeleteReminder(reminder.id);
                              }}
                            >
                              {isDeletingReminder ? (
                                <Loader2 size={14} className="reminder-delete-spinner" />
                              ) : (
                                <Trash2 size={14} />
                              )}
                            </IconButton>
                          </Flex>
                        </Card>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <Flex align="center" justify="center" p="4" className="empty-state">
                <Text size="2" color="gray">No scheduled reminders.</Text>
            </Flex>
          )}
        </Box>
      </Popover.Content>
    </Popover.Root>
  );
}
