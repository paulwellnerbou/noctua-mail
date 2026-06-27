"use client";

import { AlertDialog, Button, Flex, Text } from "@radix-ui/themes";
import AlertDialogContent from "@/app/components/mailclient/message/AlertDialogContent";
import type { CalendarEventDeleteScope } from "./EventDetailView";
import styles from "./EventDetailView.module.css";

export type EventDeleteScopeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  timeRange: string;
  responseOccurrenceLabel: string;
  responseTargetLabel: string;
  deletingEvent: boolean;
  onDelete: (scope: CalendarEventDeleteScope) => void | Promise<void>;
};

/**
 * Confirmation prompt shown before deleting a recurring event. Lets the user
 * choose whether to remove only the currently-viewed occurrence, this and all
 * following occurrences, or the whole series. Non-recurring events skip this
 * dialog and are deleted directly.
 */
export default function EventDeleteScopeDialog({
  open,
  onOpenChange,
  title,
  timeRange,
  responseOccurrenceLabel,
  responseTargetLabel,
  deletingEvent,
  onDelete
}: EventDeleteScopeDialogProps) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!deletingEvent) {
          onOpenChange(next);
        }
      }}
    >
      <AlertDialogContent size="2">
        <AlertDialog.Title size="3">Delete recurring event?</AlertDialog.Title>
        <AlertDialog.Description>
          Choose whether to remove only {responseOccurrenceLabel.toLowerCase()}, this and all following
          occurrences, or the whole series.
        </AlertDialog.Description>
        <div className={styles.responseSummary}>
          <Text size="2" weight="medium">{title || "Untitled Event"}</Text>
          {timeRange && (
            <Text size="1" color="gray">{responseTargetLabel}</Text>
          )}
        </div>
        <Flex gap="3" mt="4" justify="end" wrap="wrap">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray" disabled={deletingEvent}>
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button
              variant="soft"
              color="gray"
              disabled={deletingEvent}
              onClick={() => void onDelete("occurrence")}
            >
              {responseOccurrenceLabel}
            </Button>
          </AlertDialog.Action>
          <AlertDialog.Action>
            <Button
              variant="soft"
              color="gray"
              disabled={deletingEvent}
              onClick={() => void onDelete("following")}
            >
              This and all following
            </Button>
          </AlertDialog.Action>
          <AlertDialog.Action>
            <Button
              color="red"
              disabled={deletingEvent}
              onClick={() => void onDelete("series")}
            >
              Whole series
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialogContent>
    </AlertDialog.Root>
  );
}
