"use client";

import { useCallback, useMemo } from "react";
import { Trash2, X } from "lucide-react";
import { Badge, Box, Card, Flex, IconButton, Popover, Text } from "@radix-ui/themes";
import {
  deleteCalendarReminder,
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

function formatUpcomingReminderTime(triggerAtMs: number) {
  const diffMs = triggerAtMs - Date.now();
  const absolute = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(triggerAtMs));
  if (diffMs <= 0) return `Now (${absolute})`;
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 60) return `In ${Math.max(1, minutes)}m (${absolute})`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `In ${hours}h ${minutes % 60}m (${absolute})`;
  const days = Math.floor(hours / 24);
  return `In ${days}d ${hours % 24}h (${absolute})`;
}

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
  const nextReminder = pendingCalendarReminders[0] ?? null;
  const reminderCount = pendingCalendarReminders.length;
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
        pendingCalendarReminders,
        (reminder) =>
          Number(reminder.nextEventStartAtMs ?? reminder.eventStartAtMs ?? reminder.triggerAtMs ?? Number.NaN)
      ),
    [pendingCalendarReminders]
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
        <Flex align="center" justify="between" className="popover-title reminder-title">
          <Text size="1" weight="medium" className="bottom-popover-heading">
            {reminderHeading}
          </Text>
          <IconButton
            variant="soft"
            color="gray"
            size="1"
            title="Close reminders"
            aria-label="Close reminders"
            onClick={() => onOpenChange(false)}
          >
            <X size={12} />
          </IconButton>
        </Flex>
        <Box className="popover-body">
          {pendingCalendarReminders.length > 0 ? (
            <div className="reminder-groups">
              {groupedReminders.map((group) => (
                <section key={group.key} className="reminder-group">
                  <Text as="p" size="1" weight="medium" className="reminder-group-label">
                    {group.label}
                  </Text>
                  <div className="reminder-list">
                    {group.items.map((reminder) => (
                      <Card key={reminder.id} size="1" className="reminder-item">
                        <Flex align="start" justify="between" gap="2">
                          <button
                            type="button"
                            className={`reminder-open-button ${reminder.messageId ? "interactive" : ""}`}
                            onClick={() => {
                              if (!reminder.messageId) {
                                console.warn("[noctua][reminder-link] missing reminder.messageId", {
                                  reminderId: reminder.id,
                                  eventTitle: reminder.eventTitle,
                                  triggerAtMs: reminder.triggerAtMs
                                });
                                return;
                              }
                              console.info("[noctua][reminder-link] reminder row click", {
                                reminderId: reminder.id,
                                messageId: reminder.messageId,
                                eventTitle: reminder.eventTitle
                              });
                              onOpenReminderMessage(reminder.messageId);
                              onOpenChange(false);
                            }}
                            title={reminder.messageId ? "Open source mail" : undefined}
                            aria-label={reminder.messageId ? "Open source mail" : undefined}
                          >
                            <Flex direction="column" gap="1" className="reminder-item-main">
                              <Text as="div" size="3" weight="medium" className="reminder-item-title">
                                {reminder.eventTitle}
                              </Text>
                              <Flex align="center" gap="2" wrap="wrap" className="reminder-item-tags">
                                <Badge size="1" variant="soft" color="gray">
                                  {reminder.leadLabel}
                                </Badge>
                                <Text as="span" size="1" className="reminder-item-meta">
                                  Reminder: {formatUpcomingReminderTime(reminder.triggerAtMs)}
                                </Text>
                                <Text as="span" size="1" className="reminder-item-meta">
                                  Starts: {formatEventStartTime(reminder.nextEventStartAtMs)}
                                </Text>
                              </Flex>
                              {reminder.eventLocation ? (
                                <Text as="div" size="1" className="reminder-item-meta reminder-item-location">
                                  Location: {reminder.eventLocation}
                                </Text>
                              ) : null}
                            </Flex>
                          </button>
                          <IconButton
                            variant="soft"
                            color="gray"
                            size="1"
                            title="Delete reminder"
                            aria-label="Delete reminder"
                            onClick={() => {
                              void handleDeleteReminder(reminder.id);
                            }}
                          >
                            <Trash2 size={12} />
                          </IconButton>
                        </Flex>
                      </Card>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <Text size="2">No scheduled reminders.</Text>
          )}
        </Box>
      </Popover.Content>
    </Popover.Root>
  );
}
