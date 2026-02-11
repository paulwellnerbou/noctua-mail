"use client";

import { useCallback, useMemo } from "react";
import { Trash2, X, MapPin, Clock } from "lucide-react";
import { Box, Card, Flex, IconButton, Popover, Text, Heading, Badge } from "@radix-ui/themes";
import {
  deleteCalendarReminder,
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

function formatEventStartTime(eventStartAtMs: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(eventStartAtMs));
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
  const reminderHeading = `${reminderCount} Reminder${reminderCount === 1 ? "" : "s"}`;
  const remindersStatusValue = (() => {
    if (!nextReminder) return "None";
    const reminderTitle = nextReminder.eventTitle || "Calendar event";
    const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(
      new Date(nextReminder.triggerAtMs)
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

  const handleDeleteReminder = useCallback(
    async (reminderId: string) => {
      if (!activeAccountId) return;
      try {
        await deleteCalendarReminder(activeAccountId, reminderId);
        await onRefreshPendingReminders();
      } catch {
        onReportError("Failed to delete reminder.");
      }
    },
    [activeAccountId, onRefreshPendingReminders, onReportError]
  );

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
        <Box className="popover-body">
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
                      const startAtMs = getCalendarReminderStartAtMs(reminder);
                      return (
                        <Card key={reminder.id} size="1" className="reminder-item-card">
                          <Flex align="start" justify="between" gap="3">
                            <button
                              type="button"
                              className={`reminder-open-button ${reminder.messageId ? "interactive" : ""}`}
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
                                <Flex align="center" gap="1" className="reminder-meta-row" wrap="wrap">
                                    <Clock size={12} className="reminder-icon" />
                                    <Text size="1" weight="bold" color="gray" highContrast>
                                        {formatEventStartTime(startAtMs)}
                                    </Text>
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
                              </Flex>
                            </button>
                            <IconButton
                              variant="ghost"
                              color="gray"
                              size="1"
                              title="Delete reminder"
                              aria-label="Delete reminder"
                              className="reminder-delete-btn"
                              onClick={() => {
                                void handleDeleteReminder(reminder.id);
                              }}
                            >
                              <Trash2 size={14} />
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
