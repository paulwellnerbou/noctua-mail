"use client";

import { useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import { Flex, Heading, IconButton } from "@radix-ui/themes";
import { X, ExternalLink, RefreshCw } from "lucide-react";
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
  onClose: () => void;
  onOpenMessage?: (messageId: string) => void;
  onFindRelatedByInviteUid?: (uid: string) => void;
};

export default function CalendarSidebarPanel({
  accountId,
  onClose,
  onOpenMessage,
  onFindRelatedByInviteUid
}: Props) {
  const calendarRef = useRef<FullCalendar>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | CalendarReminder | null>(null);
  const [selectedKind, setSelectedKind] = useState<"event" | "reminder" | null>(null);
  const [recomputingRelations, setRecomputingRelations] = useState(false);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [createStart, setCreateStart] = useState<Date | undefined>();
  const [createEnd, setCreateEnd] = useState<Date | undefined>();
  const [createAllDay, setCreateAllDay] = useState(false);

  const handleOpenWindow = () => {
    openDetachedWindow(`/calendar/window?accountId=${encodeURIComponent(accountId)}`);
  };

  const handleRecomputeRelations = async () => {
    if (recomputingRelations) return;
    setRecomputingRelations(true);
    try {
      const res = await fetch("/api/calendar/recompute-relations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId })
      });
      const data = await res.json();
      if (data.ok) {
        console.log("[Calendar] Recomputed event relations:", data);
        calendarRef.current?.getApi().refetchEvents();
      } else {
        console.error("[Calendar] Recompute relations failed:", data);
      }
    } catch (err) {
      console.error("[Calendar] Recompute relations error:", err);
    } finally {
      setRecomputingRelations(false);
    }
  };

  const handleEventClick = (ev: CalendarEvent | CalendarReminder, kind: "event" | "reminder") => {
    setSelectedEvent(ev);
    setSelectedKind(kind);
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
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            title="Recompute event-email relations"
            aria-label="Recompute event-email relations"
            disabled={recomputingRelations}
            onClick={handleRecomputeRelations}
          >
            <RefreshCw size={13} style={recomputingRelations ? { opacity: 0.5 } : undefined} />
          </IconButton>
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
            onBack={() => {
              setSelectedEvent(null);
              setSelectedKind(null);
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
