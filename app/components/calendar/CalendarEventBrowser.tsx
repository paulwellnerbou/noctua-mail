"use client";

import { useCallback, useRef, useState } from "react";
import type FullCalendar from "@fullcalendar/react";
import type { AccountDateFormat, CalendarEvent, CalendarReminder } from "@/lib/data";
import dynamic from "next/dynamic";
import { buildAccountCalendarEventPath } from "@/lib/accountApiPaths";
import InAppNoticeStack from "@/app/components/mailclient/InAppNoticeStack";
import { NOTICE_TIMEOUTS } from "@/app/components/mailclient/constants";
import { dispatchCalendarRemindersUpdatedEvent } from "@/app/components/mailclient/utils/calendarReminders";
import { useInAppNotices } from "@/app/components/mailclient/useInAppNotices";
import { dispatchCalendarEventsUpdatedEvent } from "./calendarEventsClient";
import EventDetailPanel from "./EventDetailPanel";
import type { CalendarEventDeleteAction } from "./EventDetailView";

const CalendarView = dynamic(() => import("./CalendarView"), { ssr: false });

type Props = {
  accountId: string;
  firstDay?: 0 | 1;
  dateFormat?: AccountDateFormat;
  calendarRef?: React.RefObject<FullCalendar | null>;
  onOpenMessage?: (messageId: string) => void;
  onFindRelatedByInviteUid?: (uid: string) => void;
};

export default function CalendarEventBrowser({
  accountId,
  firstDay,
  dateFormat,
  calendarRef: externalCalendarRef,
  onOpenMessage,
  onFindRelatedByInviteUid
}: Props) {
  const internalCalendarRef = useRef<FullCalendar>(null);
  const calendarRef = externalCalendarRef ?? internalCalendarRef;
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | CalendarReminder | null>(null);
  const [selectedKind, setSelectedKind] = useState<"event" | "reminder" | null>(null);
  const [selectedOccurrenceStartAtMs, setSelectedOccurrenceStartAtMs] = useState<number | undefined>();
  const { inAppNotices, pushNotice, dismissNotice } = useInAppNotices();

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
          title: scope === "occurrence" ? "Occurrence restored." : "Event restored.",
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
      title: scope === "occurrence" ? "Occurrence removed." : "Event deleted.",
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
      dateFormat={dateFormat}
    />
  ) : (
    <CalendarView
      accountId={accountId}
      calendarRef={calendarRef}
      firstDay={firstDay}
      dateFormat={dateFormat}
      onEventClick={handleEventClick}
    />
  );

  return (
    <>
      {content}
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
