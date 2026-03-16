"use client";

import { useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import type { CalendarEvent, CalendarReminder } from "@/lib/data";
import dynamic from "next/dynamic";
import EventDetailPanel from "./EventDetailPanel";

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
    calendarRef.current?.getApi().refetchEvents();
  };

  const handleEventDeleted = () => {
    handleBack();
    calendarRef.current?.getApi().refetchEvents();
  };

  if (selectedEvent && selectedKind) {
    return (
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
      />
    );
  }

  return (
    <CalendarView
      accountId={accountId}
      calendarRef={calendarRef}
      firstDay={firstDay}
      onEventClick={handleEventClick}
    />
  );
}
