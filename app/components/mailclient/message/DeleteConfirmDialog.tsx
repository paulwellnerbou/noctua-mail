import React from "react";
import { AlertDialog, Box, Button, Flex, Text } from "@radix-ui/themes";
import type { DeleteConfirmAction, DeleteConfirmState } from "../types";
import type { LinkedCalendarEventDetail } from "../utils/deleteConfirm";
import { formatCalendarEventRange } from "@/lib/calendar";
import type { AccountDateFormat } from "@/lib/data";
import { useAccountDateFormat } from "@/app/components/AccountDateFormatContext";
import AlertDialogContent from "./AlertDialogContent";

interface DeleteConfirmDialogProps {
  deleteConfirm: DeleteConfirmState | null;
  onOpenChange: (open: boolean) => void;
  resolveDeleteConfirm: (action: DeleteConfirmAction) => void;
}

function formatCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getDeleteTitle(deleteConfirm: DeleteConfirmState) {
  if (deleteConfirm.permanentDeleteCount > 0) {
    if (deleteConfirm.kind === "thread") return "Delete thread?";
    if (deleteConfirm.messageCount === 1) return "Delete message?";
    return "Delete messages?";
  }
  if (deleteConfirm.kind === "thread") return "Move thread to Trash?";
  if (deleteConfirm.messageCount === 1) return "Move message to Trash?";
  return "Move messages to Trash?";
}

function getDeleteDescription(deleteConfirm: DeleteConfirmState) {
  if (deleteConfirm.permanentDeleteCount > 0) {
    if (deleteConfirm.moveToTrashCount > 0) {
      return `${formatCountLabel(deleteConfirm.permanentDeleteCount, "message")} will be deleted permanently, and ${formatCountLabel(deleteConfirm.moveToTrashCount, "message")} will be moved to Trash.`;
    }
    if (deleteConfirm.kind === "thread") {
      return deleteConfirm.permanentDeleteCount > 1
        ? `All ${deleteConfirm.permanentDeleteCount} messages in this thread will be deleted permanently.`
        : "This message will be deleted permanently.";
    }
    return deleteConfirm.permanentDeleteCount > 1
      ? `${deleteConfirm.permanentDeleteCount} messages will be deleted permanently.`
      : "This message will be deleted permanently.";
  }
  if (deleteConfirm.kind === "thread") {
    return deleteConfirm.messageCount > 1
      ? `All ${deleteConfirm.messageCount} messages in this thread will be moved to Trash.`
      : "This message will be moved to Trash.";
  }
  return deleteConfirm.messageCount > 1
    ? `${deleteConfirm.messageCount} messages will be moved to Trash.`
    : "This message will be moved to Trash.";
}

function formatLinkedItemLabel(
  total: number,
  future: number,
  past: number,
  singular: string
) {
  if (total === 0) return null;
  const base = formatCountLabel(total, singular);
  if (future === total) return `${base} in the future`;
  if (past === total) return `${base} in the past`;
  if (future > 0 && past > 0) {
    return `${base} (${past} in the past, ${future} in the future)`;
  }
  return base;
}

function getCalendarAssociationDescription(deleteConfirm: DeleteConfirmState) {
  const hasEvents = deleteConfirm.calendarLinkedEventCount > 0;
  const hasReminders = deleteConfirm.calendarLinkedReminderCount > 0;
  if ((!hasEvents && !hasReminders) || deleteConfirm.calendarLinkedMessageCount === 0) {
    return null;
  }

  // Events take precedence: when an event is linked, the reminder is implicit and we don't mention it.
  const itemLabel = hasEvents
    ? formatLinkedItemLabel(
        deleteConfirm.calendarLinkedEventCount,
        deleteConfirm.calendarLinkedEventFutureCount,
        deleteConfirm.calendarLinkedEventPastCount,
        "calendar event"
      )
    : formatLinkedItemLabel(
        deleteConfirm.calendarLinkedReminderCount,
        deleteConfirm.calendarLinkedReminderFutureCount,
        deleteConfirm.calendarLinkedReminderPastCount,
        "reminder"
      );
  if (!itemLabel) return null;

  const visibleCount = hasEvents
    ? deleteConfirm.calendarLinkedEventCount
    : deleteConfirm.calendarLinkedReminderCount;

  const subject =
    deleteConfirm.kind === "thread"
      ? deleteConfirm.calendarLinkedMessageCount === 1
        ? "1 email in this thread is"
        : `${deleteConfirm.calendarLinkedMessageCount} emails in this thread are`
      : deleteConfirm.messageCount === 1
        ? "This email is"
        : deleteConfirm.calendarLinkedMessageCount === 1
          ? "1 selected email is"
          : `${deleteConfirm.calendarLinkedMessageCount} selected emails are`;

  return `${subject} linked to ${itemLabel}. Deleting the email will not remove ${visibleCount === 1 ? "that calendar item" : "those calendar items"}.`;
}

function getDeleteLinkedLabel(deleteConfirm: DeleteConfirmState) {
  if (deleteConfirm.calendarLinkedEventCount > 0) {
    return deleteConfirm.calendarLinkedEventCount === 1
      ? "Delete event and Mail"
      : "Delete events and Mail";
  }
  if (deleteConfirm.calendarLinkedReminderCount > 0) {
    return deleteConfirm.calendarLinkedReminderCount === 1
      ? "Delete reminder and Mail"
      : "Delete reminders and Mail";
  }
  return "Delete Mail only";
}

function formatLinkedEventRange(event: LinkedCalendarEventDetail, dateFormat?: AccountDateFormat) {
  if (!Number.isFinite(event.occurrenceStartAtMs) || event.occurrenceStartAtMs <= 0) return "";
  return formatCalendarEventRange(
    new Date(event.occurrenceStartAtMs),
    event.occurrenceEndAtMs && event.occurrenceEndAtMs > event.occurrenceStartAtMs
      ? new Date(event.occurrenceEndAtMs)
      : undefined,
    { allDay: event.allDay, startTimeZone: event.startTimezone, dateFormat }
  );
}

function LinkedEventList({
  events,
  dateFormat
}: {
  events: LinkedCalendarEventDetail[];
  dateFormat?: AccountDateFormat;
}) {
  if (events.length === 0) return null;
  return (
    <Box mt="3">
      <Flex direction="column" gap="2">
        {events.map((event) => {
          const rangeLabel = formatLinkedEventRange(event, dateFormat);
          const isNextOccurrence =
            event.isRecurring && event.isFuture && !event.isMessageSpecificOccurrence;
          return (
            <Box key={event.id}>
              <Text as="div" size="2" weight="medium">
                {event.summary}
                {event.isRecurring ? " (recurring)" : ""}
              </Text>
              {rangeLabel ? (
                <Text as="div" size="2" color="gray">
                  {isNextOccurrence ? `Next: ${rangeLabel}` : rangeLabel}
                </Text>
              ) : null}
              {event.location ? (
                <Text as="div" size="2" color="gray">
                  {event.location}
                </Text>
              ) : null}
            </Box>
          );
        })}
      </Flex>
    </Box>
  );
}

export default function DeleteConfirmDialog({
  deleteConfirm,
  onOpenChange,
  resolveDeleteConfirm
}: DeleteConfirmDialogProps) {
  const accountDateFormat = useAccountDateFormat();
  const calendarDescription =
    deleteConfirm ? getCalendarAssociationDescription(deleteConfirm) : null;
  const hasLinkedCalendarItems =
    Boolean(deleteConfirm) &&
    (deleteConfirm!.calendarLinkedReminderCount > 0 || deleteConfirm!.calendarLinkedEventCount > 0);

  return (
    <AlertDialog.Root open={Boolean(deleteConfirm)} onOpenChange={onOpenChange}>
      <AlertDialogContent size="2">
        <AlertDialog.Title size="3">
          {deleteConfirm ? getDeleteTitle(deleteConfirm) : "Delete message?"}
        </AlertDialog.Title>
        <AlertDialog.Description>
          {deleteConfirm ? getDeleteDescription(deleteConfirm) : "This message will be deleted."}
          {calendarDescription ? ` ${calendarDescription}` : null}
        </AlertDialog.Description>
        {deleteConfirm && deleteConfirm.linkedEvents.length > 0 ? (
          <LinkedEventList events={deleteConfirm.linkedEvents} dateFormat={accountDateFormat} />
        ) : null}
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" onClick={() => resolveDeleteConfirm("cancel")}>
              Cancel
            </Button>
          </AlertDialog.Cancel>
          {hasLinkedCalendarItems ? (
            <>
              <AlertDialog.Action>
                <Button
                  variant="soft"
                  color="gray"
                  onClick={() => resolveDeleteConfirm("delete_mail_only")}
                >
                  Delete Mail only
                </Button>
              </AlertDialog.Action>
              <AlertDialog.Action>
                <Button
                  color={deleteConfirm && deleteConfirm.permanentDeleteCount > 0 ? "red" : "gray"}
                  variant={deleteConfirm && deleteConfirm.permanentDeleteCount > 0 ? "solid" : "soft"}
                  onClick={() => resolveDeleteConfirm("delete_linked_and_mail")}
                >
                  {deleteConfirm ? getDeleteLinkedLabel(deleteConfirm) : "Delete Mail only"}
                </Button>
              </AlertDialog.Action>
            </>
          ) : (
            <AlertDialog.Action>
              <Button
                color={deleteConfirm && deleteConfirm.permanentDeleteCount > 0 ? "red" : "gray"}
                variant={deleteConfirm && deleteConfirm.permanentDeleteCount > 0 ? "solid" : "soft"}
                onClick={() => resolveDeleteConfirm("delete_mail_only")}
              >
                {deleteConfirm && deleteConfirm.permanentDeleteCount > 0
                  ? "Delete permanently"
                  : "Move to Trash"}
              </Button>
            </AlertDialog.Action>
          )}
        </Flex>
      </AlertDialogContent>
    </AlertDialog.Root>
  );
}
