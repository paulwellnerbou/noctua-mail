"use client";

import { Button, Text } from "@radix-ui/themes";
import type {
  CalendarInviteActionType,
  CalendarInviteUnprocessedReason
} from "@/lib/calendarInviteProcessing";
import type { AccountDateFormat } from "@/lib/data";
import { formatAccountDateValue } from "@/lib/dateFormatting";
import styles from "./EventDetailView.module.css";

export type InviteProcessingState = {
  actionType: CalendarInviteActionType;
  processed: boolean;
  processedAtMs?: number;
  processedAutomatically?: boolean;
  unprocessedReason?: CalendarInviteUnprocessedReason;
  processing?: boolean;
  onProcess?: () => void | Promise<void>;
};

export type EventInviteStatusRowProps = {
  inviteProcessing: InviteProcessingState;
  dateFormat?: AccountDateFormat;
  /** When the invite is an occurrence-scoped cancellation, the main row hides
   *  its Process button; the cancellation action then surfaces via the main
   *  action bar instead. */
  hasOccurrenceCancellationAction: boolean;
};

function getInviteActionLabel(actionType: CalendarInviteActionType) {
  if (actionType === "cancellation") return "Cancellation";
  if (actionType === "update") return "Update";
  return "Invitation";
}

function getInviteProcessButtonLabel(processed?: boolean) {
  return processed ? "Reprocess" : "Process";
}

function getInviteProcessButtonPendingLabel(processed?: boolean) {
  return processed ? "Reprocessing…" : "Processing…";
}

function getInviteUnprocessedReasonLabel(reason?: CalendarInviteUnprocessedReason) {
  if (reason === "event_series_not_found") return "event series not found";
  return "";
}

export function buildInviteStatusText(
  inviteProcessing: InviteProcessingState,
  dateFormat?: AccountDateFormat
) {
  const actionLabel = getInviteActionLabel(inviteProcessing.actionType);
  if (!inviteProcessing.processed) {
    const reasonLabel = getInviteUnprocessedReasonLabel(inviteProcessing.unprocessedReason);
    return `${actionLabel} not processed${reasonLabel ? ` (${reasonLabel})` : ""}`;
  }
  const processedModeLabel =
    typeof inviteProcessing.processedAutomatically === "boolean"
      ? ` ${inviteProcessing.processedAutomatically ? "automatically" : "manually"}`
      : "";
  const processedAtLabel =
    typeof inviteProcessing.processedAtMs === "number"
      ? formatAccountDateValue(inviteProcessing.processedAtMs, dateFormat)
      : null;
  return `${actionLabel} processed${processedModeLabel}${processedAtLabel ? ` on ${processedAtLabel}` : ""}`;
}

/**
 * Top-of-card status banner that summarizes whether an invitation / update /
 * cancellation has been processed and offers a single-click Process button
 * when a handler is wired.
 */
export default function EventInviteStatusRow({
  inviteProcessing,
  dateFormat,
  hasOccurrenceCancellationAction
}: EventInviteStatusRowProps) {
  const statusText = buildInviteStatusText(inviteProcessing, dateFormat);
  return (
    <div className={styles.inviteStatusRow}>
      <Text size="1" color={inviteProcessing.processed ? "green" : "gray"}>
        {statusText}
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
