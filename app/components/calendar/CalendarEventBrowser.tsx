"use client";

import { useCallback, useRef, useState } from "react";
import type FullCalendar from "@fullcalendar/react";
import type { CalendarEvent, CalendarReminder } from "@/lib/data";
import dynamic from "next/dynamic";
import { buildAccountCalendarEventPath } from "@/lib/accountApiPaths";
import InAppNoticeStack from "@/app/components/mailclient/InAppNoticeStack";
import { NOTICE_TIMEOUTS } from "@/app/components/mailclient/constants";
import { dispatchCalendarRemindersUpdatedEvent } from "@/app/components/mailclient/utils/calendarReminders";
import { useInAppNotices } from "@/app/components/mailclient/useInAppNotices";
import { dispatchCalendarEventsUpdatedEvent } from "./calendarEventsClient";
import CalendarConflictBanner from "./CalendarConflictBanner";
import EventDetailPanel from "./EventDetailPanel";
import EventDialog from "./EventDialog";
import type { CalendarEventDeleteAction, CalendarEventDeleteScope } from "./EventDetailView";

const DELETE_TITLES: Record<CalendarEventDeleteScope, string> = {
  occurrence: "Occurrence removed.",
  following: "This and all following removed.",
  series: "Event deleted."
};

const RESTORE_TITLES: Record<CalendarEventDeleteScope, string> = {
  occurrence: "Occurrence restored.",
  following: "Series restored.",
  series: "Event restored."
};

type CreateDialogState = {
  open: boolean;
  defaultStart?: Date;
  defaultEnd?: Date;
  defaultAllDay?: boolean;
};

const CalendarView = dynamic(() => import("./CalendarView"), { ssr: false });

type Props = {
  accountId: string;
  firstDay?: 0 | 1;
  calendarRef?: React.RefObject<FullCalendar | null>;
  onOpenMessage?: (messageId: string) => void;
  onFindRelatedByInviteUid?: (uid: string) => void;
};

export default function CalendarEventBrowser({
  accountId,
  firstDay,
  calendarRef: externalCalendarRef,
  onOpenMessage,
  onFindRelatedByInviteUid
}: Props) {
  const internalCalendarRef = useRef<FullCalendar>(null);
  const calendarRef = externalCalendarRef ?? internalCalendarRef;
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | CalendarReminder | null>(null);
  const [selectedKind, setSelectedKind] = useState<"event" | "reminder" | null>(null);
  const [selectedOccurrenceStartAtMs, setSelectedOccurrenceStartAtMs] = useState<number | undefined>();
  const [createDialog, setCreateDialog] = useState<CreateDialogState>({ open: false });
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const { inAppNotices, pushNotice, dismissNotice } = useInAppNotices();

  // Toolbar "＋ Event": open a blank dialog (EventDialog defaults to now → +1h).
  const handleCreateEvent = useCallback(() => {
    setCreateDialog({ open: true });
  }, []);

  // Clicking an empty day/slot pre-fills the new-event dialog with that time.
  // Month-view (and the all-day lane) clicks arrive as all-day; week/day slot
  // clicks carry the slot time.
  const handleDateClick = useCallback((date: Date, allDay: boolean) => {
    if (allDay) {
      // FullCalendar (timeZone: "local") reports an all-day cell as *local*
      // midnight, but the app stores all-day events as UTC midnight (see
      // inviteInputToMs / msToDateLocal, which read UTC components). Rebuild
      // UTC midnight from the local Y/M/D so the dialog pre-fills the day that
      // was clicked rather than the previous day for users east of UTC.
      const utcMidnight = new Date(
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
      );
      setCreateDialog({
        open: true,
        defaultStart: utcMidnight,
        defaultEnd: utcMidnight,
        defaultAllDay: true
      });
      return;
    }
    const end = new Date(date.getTime() + 60 * 60 * 1000);
    setCreateDialog({ open: true, defaultStart: date, defaultEnd: end, defaultAllDay: false });
  }, []);

  const handleCloseCreate = useCallback(() => {
    setCreateDialog((prev) => ({ ...prev, open: false }));
  }, []);

  const handleEventCreated = useCallback(
    (event: CalendarEvent) => {
      setCreateDialog({ open: false });
      dispatchCalendarEventsUpdatedEvent();
      dispatchCalendarRemindersUpdatedEvent();
      pushNotice({
        type: "success",
        title: "Event created.",
        description: event.summary,
        durationMs: NOTICE_TIMEOUTS.success
      });
    },
    [pushNotice]
  );

  const handleEventClick = (
    event: CalendarEvent | CalendarReminder,
    kind: "event" | "reminder",
    occurrenceStartAtMs?: number
  ) => {
    setSelectedEvent(event);
    setSelectedKind(kind);
    setSelectedOccurrenceStartAtMs(occurrenceStartAtMs);
  };

  const handleBack = () => {
    setSelectedEvent(null);
    setSelectedKind(null);
    setSelectedOccurrenceStartAtMs(undefined);
  };

  const handleEventUpdated = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setSelectedKind("event");
    dispatchCalendarEventsUpdatedEvent();
  };

  // "Edit" in the detail view opens the same dialog used for creation, seeded
  // with the selected event. Only local/ICS-imported events expose the button
  // (EventDetailView gates on sourceType), so the cast is safe here.
  const handleEditEvent = useCallback(() => {
    if (selectedEvent && selectedKind === "event") {
      setEditingEvent(selectedEvent as CalendarEvent);
    }
  }, [selectedEvent, selectedKind]);

  const handleEventEdited = useCallback(
    (event: CalendarEvent) => {
      setEditingEvent(null);
      setSelectedEvent(event);
      setSelectedKind("event");
      dispatchCalendarEventsUpdatedEvent();
      dispatchCalendarRemindersUpdatedEvent();
      pushNotice({
        type: "success",
        title: "Event updated.",
        description: event.summary,
        durationMs: NOTICE_TIMEOUTS.success
      });
    },
    [pushNotice]
  );

  const handleRestoreDeletedEvent = useCallback(
    async (
      event: CalendarEvent,
      scope: CalendarEventDeleteAction["scope"]
    ) => {
      try {
        const response = await fetch(buildAccountCalendarEventPath(accountId, event.id), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event)
        });
        const data = (await response.json().catch(() => null)) as
          | {
              ok?: boolean;
              event?: CalendarEvent;
              message?: string;
            }
          | null;
        if (!response.ok || data?.ok !== true || !data.event) {
          throw new Error(data?.message ?? "Failed to restore event.");
        }
        dispatchCalendarEventsUpdatedEvent();
        dispatchCalendarRemindersUpdatedEvent();
        pushNotice({
          type: "success",
          title: RESTORE_TITLES[scope],
          description: data.event.summary,
          durationMs: NOTICE_TIMEOUTS.success
        });
      } catch (error) {
        pushNotice({
          type: "error",
          title: "Failed to restore event.",
          description: error instanceof Error ? error.message : undefined,
          durationMs: NOTICE_TIMEOUTS.error
        });
      }
    },
    [accountId, pushNotice]
  );

  const handleEventDeleted = ({ event, scope }: CalendarEventDeleteAction) => {
    handleBack();
    pushNotice({
      type: "success",
      title: DELETE_TITLES[scope],
      description: event.summary,
      actionLabel: "UNDO",
      onAction: () => handleRestoreDeletedEvent(event, scope),
      durationMs: NOTICE_TIMEOUTS.success
    });
  };

  const content = selectedEvent && selectedKind ? (
    <EventDetailPanel
      event={selectedEvent}
      kind={selectedKind}
      accountId={accountId}
      occurrenceStartAtMs={selectedOccurrenceStartAtMs}
      onBack={handleBack}
      onOpenMessage={onOpenMessage}
      onFindRelatedByInviteUid={onFindRelatedByInviteUid}
      onEventUpdated={handleEventUpdated}
      onEventDeleted={handleEventDeleted}
      onEditEvent={handleEditEvent}
    />
  ) : (
    <CalendarView
      accountId={accountId}
      calendarRef={calendarRef}
      firstDay={firstDay}
      onEventClick={handleEventClick}
      onDateClick={handleDateClick}
      onCreateEvent={handleCreateEvent}
    />
  );

  return (
    <>
      <CalendarConflictBanner accountId={accountId} />
      {content}
      <EventDialog
        open={createDialog.open}
        accountId={accountId}
        defaultStart={createDialog.defaultStart}
        defaultEnd={createDialog.defaultEnd}
        defaultAllDay={createDialog.defaultAllDay}
        onClose={handleCloseCreate}
        onSaved={handleEventCreated}
      />
      <EventDialog
        open={Boolean(editingEvent)}
        accountId={accountId}
        event={editingEvent ?? undefined}
        onClose={() => setEditingEvent(null)}
        onSaved={handleEventEdited}
      />
      <InAppNoticeStack
        className="inapp-notice-stack-pane"
        state={{ inAppNotices }}
        actions={{
          onOpenNotice: () => {},
          onDismissNotice: dismissNotice
        }}
      />
    </>
  );
}
