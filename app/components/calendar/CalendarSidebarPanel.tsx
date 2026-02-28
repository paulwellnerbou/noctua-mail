"use client";

import { useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import { Flex, Heading, IconButton } from "@radix-ui/themes";
import { X, ExternalLink } from "lucide-react";
import { openDetachedWindow } from "@/lib/ui/openDetachedWindow";
import type { CalendarEvent } from "@/lib/data";
import type { CalendarReminder } from "@/lib/data";
import dynamic from "next/dynamic";
import EventDialog from "./EventDialog";
import styles from "./CalendarSidebarPanel.module.css";

const CalendarView = dynamic(() => import("./CalendarView"), { ssr: false });

type Props = {
  accountId: string;
  onClose: () => void;
};

export default function CalendarSidebarPanel({ accountId, onClose }: Props) {
  const calendarRef = useRef<FullCalendar>(null);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Partial<CalendarEvent> | undefined>();
  const [createStart, setCreateStart] = useState<Date | undefined>();
  const [createEnd, setCreateEnd] = useState<Date | undefined>();
  const [createAllDay, setCreateAllDay] = useState(false);

  const handleOpenWindow = () => {
    openDetachedWindow(`/calendar/window?accountId=${encodeURIComponent(accountId)}`);
  };

  const handleEventClick = (ev: CalendarEvent | CalendarReminder, kind: "event" | "reminder") => {
    if (kind === "event") {
      setEditingEvent(ev as CalendarEvent);
      setCreateStart(undefined);
      setEventDialogOpen(true);
    }
  };

  const handleCreateEvent = (start: Date, end: Date, allDay: boolean) => {
    setEditingEvent(undefined);
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

  return (
    <div className={styles.panel}>
      <Flex align="center" justify="between" className={styles.header}>
        <Heading size="2">Calendar</Heading>
        <Flex gap="1" align="center">
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
        <CalendarView
          accountId={accountId}
          calendarRef={calendarRef}
          onEventClick={handleEventClick}
          onCreateEvent={handleCreateEvent}
        />
      </div>
      <EventDialog
        open={eventDialogOpen}
        accountId={accountId}
        event={editingEvent}
        defaultStart={createStart}
        defaultEnd={createEnd}
        defaultAllDay={createAllDay}
        onClose={() => {
          setEventDialogOpen(false);
          setEditingEvent(undefined);
        }}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
