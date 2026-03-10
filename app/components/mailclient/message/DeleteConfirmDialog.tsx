import React from "react";
import { AlertDialog, Button, Flex } from "@radix-ui/themes";
import type { DeleteConfirmAction, DeleteConfirmState } from "../types";

interface DeleteConfirmDialogProps {
  deleteConfirm: DeleteConfirmState | null;
  onOpenChange: (open: boolean) => void;
  resolveDeleteConfirm: (action: DeleteConfirmAction) => void;
}

function formatCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function joinNatural(parts: string[]) {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
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

function getCalendarAssociationDescription(deleteConfirm: DeleteConfirmState) {
  const linkedItemCount =
    deleteConfirm.calendarLinkedReminderCount + deleteConfirm.calendarLinkedEventCount;
  if (linkedItemCount === 0 || deleteConfirm.calendarLinkedMessageCount === 0) return null;

  const linkedItems = [
    deleteConfirm.calendarLinkedReminderCount > 0
      ? formatCountLabel(deleteConfirm.calendarLinkedReminderCount, "reminder")
      : null,
    deleteConfirm.calendarLinkedEventCount > 0
      ? formatCountLabel(deleteConfirm.calendarLinkedEventCount, "calendar event")
      : null
  ].filter((value): value is string => Boolean(value));

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

  return `${subject} linked to ${joinNatural(linkedItems)}. Deleting the email will not remove ${linkedItemCount === 1 ? "that calendar item" : "those calendar items"}.`;
}

function getDeleteLinkedLabel(deleteConfirm: DeleteConfirmState) {
  if (deleteConfirm.calendarLinkedEventCount > 0 && deleteConfirm.calendarLinkedReminderCount > 0) {
    return "Delete event/reminder and Mail";
  }
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

export default function DeleteConfirmDialog({
  deleteConfirm,
  onOpenChange,
  resolveDeleteConfirm
}: DeleteConfirmDialogProps) {
  const calendarDescription =
    deleteConfirm ? getCalendarAssociationDescription(deleteConfirm) : null;
  const hasLinkedCalendarItems =
    Boolean(deleteConfirm) &&
    (deleteConfirm.calendarLinkedReminderCount > 0 || deleteConfirm.calendarLinkedEventCount > 0);

  return (
    <AlertDialog.Root open={Boolean(deleteConfirm)} onOpenChange={onOpenChange}>
      <AlertDialog.Content size="2" style={{ width: "min(460px, 92vw)" }}>
        <AlertDialog.Title size="3">
          {deleteConfirm ? getDeleteTitle(deleteConfirm) : "Delete message?"}
        </AlertDialog.Title>
        <AlertDialog.Description>
          {deleteConfirm ? getDeleteDescription(deleteConfirm) : "This message will be deleted."}
          {calendarDescription ? ` ${calendarDescription}` : null}
        </AlertDialog.Description>
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
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
