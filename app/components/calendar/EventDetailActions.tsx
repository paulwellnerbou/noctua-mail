"use client";

import { AlarmClock, AlarmClockPlus, Trash2 } from "lucide-react";
import { Button } from "@radix-ui/themes";
import type { CalendarInviteActionType } from "@/lib/calendarInviteProcessing";
import type { CalendarReminder } from "@/app/components/mailclient/utils/calendarReminders";
import styles from "./EventDetailView.module.css";

export type EventDetailActionsProps = {
  /** Whether to show the action bar at all. Past events without a scheduled
   *  reminder typically render nothing here. */
  show: boolean;
  hasOccurrenceCancellationAction: boolean;
  inviteProcessing?: {
    actionType: CalendarInviteActionType;
    processed: boolean;
    processing?: boolean;
    onProcess?: () => void | Promise<void>;
  };
  eventId?: string;
  canRespond: boolean;
  currentParticipationColor: "green" | "red" | "orange" | "gray";
  currentParticipationLabel: string;
  submittingResponse: boolean;
  onOpenResponseDialog: () => void;
  canScheduleReminder: boolean;
  existingReminder: CalendarReminder | null;
  onOpenReminderDialog: () => void;
  deletingReminder: boolean;
  onDeleteReminder: () => void | Promise<void>;
  /** Presence indicates the parent handles event deletion; the delete button
   *  hides when omitted. */
  canDeleteEvent: boolean;
  deletingEvent: boolean;
  onDeleteEvent: () => void;
};

function getOccurrenceInviteActionLabel(actionType?: CalendarInviteActionType) {
  if (actionType === "cancellation") return "RSVP: Cancel";
  return "RSVP";
}

/**
 * Horizontal button strip rendered below the event body: RSVP, reminder
 * scheduling, and the delete button. The email cross-link lives in the
 * "Original Email" snapshot header so it sits next to the content it opens.
 */
export default function EventDetailActions({
  show,
  hasOccurrenceCancellationAction,
  inviteProcessing,
  eventId,
  canRespond,
  currentParticipationColor,
  currentParticipationLabel,
  submittingResponse,
  onOpenResponseDialog,
  canScheduleReminder,
  existingReminder,
  onOpenReminderDialog,
  deletingReminder,
  onDeleteReminder,
  canDeleteEvent,
  deletingEvent,
  onDeleteEvent
}: EventDetailActionsProps) {
  if (!show) return null;

  return (
    <div className={styles.actions}>
      {hasOccurrenceCancellationAction && !inviteProcessing?.processed && (
        <Button
          size="1"
          variant="soft"
          color={inviteProcessing?.actionType === "cancellation" ? "red" : "indigo"}
          disabled={Boolean(inviteProcessing?.processing)}
          onClick={() => void inviteProcessing?.onProcess?.()}
        >
          {inviteProcessing?.processing
            ? inviteProcessing.actionType === "cancellation"
              ? "Cancelling..."
              : "Updating..."
            : getOccurrenceInviteActionLabel(inviteProcessing?.actionType)}
        </Button>
      )}
      {eventId && canRespond && !hasOccurrenceCancellationAction && (
        <Button
          size="1"
          variant="soft"
          color={currentParticipationColor}
          disabled={submittingResponse}
          onClick={onOpenResponseDialog}
        >
          RSVP: {currentParticipationLabel}
        </Button>
      )}
      <Button
        size="1"
        variant="soft"
        color="indigo"
        disabled={!canScheduleReminder && !existingReminder}
        title={!canScheduleReminder && !existingReminder ? "Past events cannot be scheduled" : undefined}
        onClick={onOpenReminderDialog}
      >
        {existingReminder ? <AlarmClock size={14} /> : <AlarmClockPlus size={14} />}
        {existingReminder ? "Modify Reminder" : "Schedule Reminder"}
      </Button>
      {existingReminder && (
        <Button
          size="1"
          variant="soft"
          color="gray"
          disabled={deletingReminder}
          onClick={() => void onDeleteReminder()}
        >
          <Trash2 size={14} />
          {deletingReminder ? "Removing…" : "Remove reminder"}
        </Button>
      )}
      {eventId && canDeleteEvent && (
        <Button
          size="1"
          variant="soft"
          color="red"
          disabled={deletingEvent}
          onClick={onDeleteEvent}
        >
          <Trash2 size={14} />
          {deletingEvent ? "Removing…" : "Delete event"}
        </Button>
      )}
    </div>
  );
}
