"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import { Text } from "@radix-ui/themes";
import type { CalendarEvent } from "@/lib/data";
import type { CalendarReminder } from "@/lib/data";
import dynamic from "next/dynamic";
import EventDialog from "@/app/components/calendar/EventDialog";
import styles from "./page.module.css";

const CalendarView = dynamic(() => import("@/app/components/calendar/CalendarView"), { ssr: false });

function CalendarWindowContent() {
  const searchParams = useSearchParams();
  const accountId = searchParams.get("accountId") ?? "";
  const calendarRef = useRef<FullCalendar>(null);

  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Partial<CalendarEvent> | undefined>();
  const [createStart, setCreateStart] = useState<Date | undefined>();
  const [createEnd, setCreateEnd] = useState<Date | undefined>();
  const [createAllDay, setCreateAllDay] = useState(false);

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
    calendarRef.current?.getApi().refetchEvents();
  };

  const handleDeleted = () => {
    calendarRef.current?.getApi().refetchEvents();
  };

  if (!accountId) {
    return (
      <div className={styles.page}>
        <div className={styles.state}>
          <Text size="2" color="red">Missing accountId parameter.</Text>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <CalendarView
        accountId={accountId}
        calendarRef={calendarRef}
        onEventClick={handleEventClick}
        onCreateEvent={handleCreateEvent}
      />
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

export default function CalendarWindowPage() {
  return (
    <Suspense fallback={<div className={styles.page}><div className={styles.state}><Text size="2" color="gray">Loading…</Text></div></div>}>
      <CalendarWindowContent />
    </Suspense>
  );
}
