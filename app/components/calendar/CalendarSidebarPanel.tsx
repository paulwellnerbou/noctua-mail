"use client";

import { useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import { DropdownMenu, Flex, Heading, IconButton } from "@radix-ui/themes";
import { X, ExternalLink, MoreVertical } from "lucide-react";
import { openDetachedWindow } from "@/lib/ui/openDetachedWindow";
import type { CalendarEvent } from "@/lib/data";
import type { CalendarReminder } from "@/lib/data";
import dynamic from "next/dynamic";
import EventDialog from "./EventDialog";
import EventDetailPanel from "./EventDetailPanel";
import styles from "./CalendarSidebarPanel.module.css";

const CalendarView = dynamic(() => import("./CalendarView"), { ssr: false });

type Props = {
  accountId: string;
  firstDay?: 0 | 1;
  onClose: () => void;
  onOpenMessage?: (messageId: string) => void;
  onFindRelatedByInviteUid?: (uid: string) => void;
  onRecomputeRelations?: () => Promise<void>;
  isRecomputingRelations?: boolean;
};

export default function CalendarSidebarPanel({
  accountId,
  firstDay,
  onClose,
  onOpenMessage,
  onFindRelatedByInviteUid,
  onRecomputeRelations,
  isRecomputingRelations
}: Props) {
  const calendarRef = useRef<FullCalendar>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | CalendarReminder | null>(null);
  const [selectedKind, setSelectedKind] = useState<"event" | "reminder" | null>(null);
  const [selectedOccurrenceStartAtMs, setSelectedOccurrenceStartAtMs] = useState<number | undefined>();
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [createStart, setCreateStart] = useState<Date | undefined>();
  const [createEnd, setCreateEnd] = useState<Date | undefined>();
  const [createAllDay, setCreateAllDay] = useState(false);

  const handleOpenWindow = () => {
    openDetachedWindow(`/calendar/window?accountId=${encodeURIComponent(accountId)}`);
  };

  const handleRecomputeRelations = async () => {
    if (!onRecomputeRelations) return;
    await onRecomputeRelations();
    calendarRef.current?.getApi().refetchEvents();
  };

  const handleEventClick = (
    ev: CalendarEvent | CalendarReminder,
    kind: "event" | "reminder",
    occurrenceStartAtMs?: number
  ) => {
    setSelectedEvent(ev);
    setSelectedKind(kind);
    setSelectedOccurrenceStartAtMs(occurrenceStartAtMs);
  };

  const handleCreateEvent = (start: Date, end: Date, allDay: boolean) => {
    setSelectedEvent(null);
    setSelectedKind(null);
    setCreateStart(start);
    setCreateEnd(end);
    setCreateAllDay(allDay);
    setEventDialogOpen(true);
  };

  const handleSaved = () => {
    // Trigger calendar refresh by resetting the view range
    calendarRef.current?.getApi().refetchEvents();
  };

  const handleDeleted = () => {
    calendarRef.current?.getApi().refetchEvents();
  };

  const handleEventUpdated = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setSelectedKind("event");
    calendarRef.current?.getApi().refetchEvents();
  };

  const handleEventDeleted = () => {
    setSelectedEvent(null);
    setSelectedKind(null);
    calendarRef.current?.getApi().refetchEvents();
  };

  return (
    <div className={styles.panel}>
      <Flex align="center" justify="between" className={styles.header}>
        <Heading size="2">Calendar</Heading>
        <Flex gap="1" align="center">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton size="1" variant="ghost" color="gray" title="Calendar options" aria-label="Calendar options">
                <MoreVertical size={13} />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" sideOffset={4}>
              <DropdownMenu.Item
                disabled={isRecomputingRelations}
                onSelect={() => void handleRecomputeRelations()}
              >
                Recompute event associations
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            title="Open in window"
            aria-label="Open calendar in window"
            onClick={handleOpenWindow}
          >
            <ExternalLink size={13} />
          </IconButton>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={onClose}
            aria-label="Close calendar"
          >
            <X size={15} />
          </IconButton>
        </Flex>
      </Flex>
      <div className={styles.calendarContainer}>
        {selectedEvent && selectedKind ? (
          <EventDetailPanel
            event={selectedEvent}
            kind={selectedKind}
            accountId={accountId}
            occurrenceStartAtMs={selectedOccurrenceStartAtMs}
            onBack={() => {
              setSelectedEvent(null);
              setSelectedKind(null);
              setSelectedOccurrenceStartAtMs(undefined);
            }}
            onOpenMessage={onOpenMessage}
            onFindRelatedByInviteUid={onFindRelatedByInviteUid}
            onEventUpdated={handleEventUpdated}
            onEventDeleted={handleEventDeleted}
          />
        ) : (
          <CalendarView
            accountId={accountId}
            calendarRef={calendarRef}
            firstDay={firstDay}
            onEventClick={handleEventClick}
            onCreateEvent={handleCreateEvent}
          />
        )}
      </div>
      <EventDialog
        open={eventDialogOpen}
        accountId={accountId}
        defaultStart={createStart}
        defaultEnd={createEnd}
        defaultAllDay={createAllDay}
        onClose={() => {
          setEventDialogOpen(false);
        }}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
