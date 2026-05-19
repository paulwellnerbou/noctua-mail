"use client";

import { Button, Dialog, Flex, Select, Text } from "@radix-ui/themes";
import {
  CALENDAR_REMINDER_LEAD_OPTIONS,
  type CalendarReminder
} from "@/app/components/mailclient/utils/calendarReminders";
import styles from "./EventDetailView.module.css";

export type EventReminderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  existingReminder: CalendarReminder | null;
  leadOptionValue: string;
  onLeadOptionChange: (value: string) => void;
  onSchedule: () => void | Promise<void>;
  savingReminder: boolean;
};

/**
 * Modal used to schedule a new reminder or modify an existing one. The caller
 * owns all state (lead option, saving flag, existing reminder) so that the
 * parent can keep a single source of truth for reminder persistence.
 */
export default function EventReminderDialog({
  open,
  onOpenChange,
  title,
  existingReminder,
  leadOptionValue,
  onLeadOptionChange,
  onSchedule,
  savingReminder
}: EventReminderDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !savingReminder) onOpenChange(false);
      }}
    >
      <Dialog.Content size="2" className={styles.reminderDialog}>
        <Flex direction="column" gap="3">
          <Dialog.Title size="4">{existingReminder ? "Modify Reminder" : "Schedule Reminder"}</Dialog.Title>
          <Dialog.Description size="2" color="gray">{title || "Calendar event"}</Dialog.Description>
          {existingReminder && (
            <Text size="2" color="gray">
              Current: {existingReminder.leadLabel}
            </Text>
          )}
          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">Notify me</Text>
            <Select.Root value={leadOptionValue} onValueChange={onLeadOptionChange}>
              <Select.Trigger />
              <Select.Content position="popper">
                {CALENDAR_REMINDER_LEAD_OPTIONS.map((opt) => (
                  <Select.Item key={opt.value} value={opt.value}>{opt.label}</Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
          <Flex justify="end" gap="2">
            <Button variant="soft" color="gray" onClick={() => onOpenChange(false)} disabled={savingReminder}>
              Cancel
            </Button>
            <Button onClick={() => void onSchedule()} disabled={savingReminder}>
              {savingReminder ? "Saving…" : existingReminder ? "Update reminder" : "Schedule reminder"}
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
