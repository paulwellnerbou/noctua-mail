import {
  addCalendarEventSuppression,
  cancelCalendarRemindersByEventUid,
  clearMessageCalendarInviteStatesProcessedByEventUid,
  deleteCalendarEvent,
  getCalendarEventById,
  softDeleteCalendarEvent
} from "@/lib/db";
import type { CalendarEvent } from "@/lib/data";

export type DeleteCalendarEventParams = {
  accountId: string;
  eventId: string;
  softDelete?: boolean;
};

export type DeleteCalendarEventResult = {
  event: CalendarEvent | null;
  deleted: boolean;
};

function shouldResetInviteProcessing(event: CalendarEvent) {
  return Boolean(event.messageId?.trim() || event.sourceType === "email");
}

export async function deleteCalendarEventAndRelatedData({
  accountId,
  eventId,
  softDelete = false
}: DeleteCalendarEventParams): Promise<DeleteCalendarEventResult> {
  const event = await getCalendarEventById(accountId, eventId);
  if (!event) {
    return { event: null, deleted: false };
  }

  if (softDelete) {
    await softDeleteCalendarEvent(accountId, eventId);
  } else {
    await deleteCalendarEvent(accountId, eventId);
  }

  if (event.eventUid.trim()) {
    await cancelCalendarRemindersByEventUid(accountId, event.eventUid);
    if (shouldResetInviteProcessing(event)) {
      await clearMessageCalendarInviteStatesProcessedByEventUid(accountId, event.eventUid);
      // Remember that the user removed this series so a later Google "synced
      // invitation" for the same UID key cannot silently re-create it on the
      // next sync. A manual re-import lifts the suppression.
      await addCalendarEventSuppression(accountId, event.eventUid);
    }
  }

  return { event, deleted: true };
}
