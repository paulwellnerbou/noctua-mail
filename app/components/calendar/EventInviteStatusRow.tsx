"use client";

import { Button, Text } from "@radix-ui/themes";
import type { CalendarInviteActionType } from "@/lib/calendarInviteProcessing";
import styles from "./EventDetailView.module.css";

export type InviteProcessingState = {
  actionType: CalendarInviteActionType;
  processed: boolean;
  processedAtMs?: number;
  processedAutomatically?: boolean;
  processing?: boolean;
  onProcess?: () => void | Promise<void>;
};

export type EventInviteStatusRowProps = {
  inviteProcessing: InviteProcessingState;
  inviteStatusText: string | null;
  /** When the invite is an occurrence-scoped cancellation, the main row hides
   *  its Process button; the cancellation action then surfaces via the main
   *  action bar instead. */
  hasOccurrenceCancellationAction: boolean;
};

function getInviteProcessButtonLabel(processed?: boolean) {
  return processed ? "Reprocess" : "Process";
}

function getInviteProcessButtonPendingLabel(processed?: boolean) {
  return processed ? "Reprocessing…" : "Processing…";
}

/**
 * Top-of-card status banner that summarizes whether an invitation / update /
 * cancellation has been processed and offers a single-click Process button
 * when a handler is wired.
 */
export default function EventInviteStatusRow({
  inviteProcessing,
  inviteStatusText,
  hasOccurrenceCancellationAction
}: EventInviteStatusRowProps) {
  return (
    <div className={styles.inviteStatusRow}>
      <Text size="1" color={inviteProcessing.processed ? "green" : "gray"}>
        {inviteStatusText}
      </Text>
      {inviteProcessing.onProcess && !hasOccurrenceCancellationAction && (
        <Button
          size="1"
          variant="soft"
          color="indigo"
          disabled={inviteProcessing.processing}
          onClick={() => void inviteProcessing.onProcess?.()}
        >
          {inviteProcessing.processing
            ? getInviteProcessButtonPendingLabel(inviteProcessing.processed)
            : getInviteProcessButtonLabel(inviteProcessing.processed)}
        </Button>
      )}
    </div>
  );
}
