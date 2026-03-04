"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import FullCalendar from "@fullcalendar/react";
import { Heading } from "@radix-ui/themes";
import { CalendarDays, ExternalLink, PanelRight, X } from "lucide-react";
import type { CalendarEvent, CalendarReminder } from "@/lib/data";
import { openDetachedWindow } from "@/lib/ui/openDetachedWindow";
import dynamic from "next/dynamic";
import EventDialog from "./EventDialog";
import EventDetailPanel from "./EventDetailPanel";
import styles from "./CalendarPopover.module.css";

const CalendarView = dynamic(() => import("./CalendarView"), { ssr: false });

type Props = {
  open: boolean;
  accountId: string;
  onOpenChange: (open: boolean) => void;
  onOpenSidebar: () => void;
  triggerLabel: string;
  onOpenMessage?: (messageId: string) => void;
  onFindRelatedByInviteUid?: (uid: string) => void;
};

type Position = { x: number; y: number };

const PANEL_WIDTH = 860;
const PANEL_HEIGHT = 660;

function getInitialPosition(): Position {
  if (typeof window === "undefined") return { x: 100, y: 100 };
  return {
    x: Math.max(8, (window.innerWidth - PANEL_WIDTH) / 2),
    y: Math.max(8, window.innerHeight - PANEL_HEIGHT - 36)
  };
}

export default function CalendarPopover({
  open,
  accountId,
  onOpenChange,
  onOpenSidebar,
  triggerLabel,
  onOpenMessage,
  onFindRelatedByInviteUid
}: Props) {
  const calendarRef = useRef<FullCalendar>(null);
  const [position, setPosition] = useState<Position>(getInitialPosition);
  const dragStateRef = useRef({ active: false, startX: 0, startY: 0, posX: 0, posY: 0 });

  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | CalendarReminder | null>(null);
  const [selectedKind, setSelectedKind] = useState<"event" | "reminder" | null>(null);

  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [createStart, setCreateStart] = useState<Date | undefined>();
  const [createEnd, setCreateEnd] = useState<Date | undefined>();
  const [createAllDay, setCreateAllDay] = useState(false);

  // Drag handling
  const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, [role=button]")) return;
    e.preventDefault();
    const ds = dragStateRef.current;
    ds.active = true;
    ds.startX = e.clientX;
    ds.startY = e.clientY;
    ds.posX = position?.x ?? 0;
    ds.posY = position?.y ?? 0;

    const onMove = (ev: MouseEvent) => {
      if (!ds.active) return;
      setPosition({
        x: ds.posX + (ev.clientX - ds.startX),
        y: ds.posY + (ev.clientY - ds.startY)
      });
    };
    const onUp = () => {
      ds.active = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const handleOpenWindow = () => {
    openDetachedWindow(`/calendar/window?accountId=${encodeURIComponent(accountId)}`);
    onOpenChange(false);
  };

  const handleOpenSidebar = () => {
    onOpenSidebar();
    onOpenChange(false);
  };

  const handleEventClick = (ev: CalendarEvent | CalendarReminder, kind: "event" | "reminder") => {
    setSelectedEvent(ev);
    setSelectedKind(kind);
  };

  const handleBackFromDetail = () => {
    setSelectedEvent(null);
    setSelectedKind(null);
  };

  const handleEventUpdated = (event: CalendarEvent) => {
    setSelectedEvent(event);
    setSelectedKind("event");
    calendarRef.current?.getApi().refetchEvents();
  };

  const handleEventSaved = () => {
    calendarRef.current?.getApi().refetchEvents();
    handleBackFromDetail();
  };

  const panel = open ? (
    <div
      className={styles.floatingPanel}
      style={{ left: position.x, top: position.y }}
    >
      <div className={styles.header} onMouseDown={handleDragStart}>
        <div className={styles.headerTitle}>
          <CalendarDays size={14} />
          <Heading size="3">Calendar</Heading>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.headerButton} title="Open in sidebar" aria-label="Open calendar in sidebar" onClick={handleOpenSidebar}>
            <PanelRight size={16} />
          </button>
          <button className={styles.headerButton} title="Open in window" aria-label="Open calendar in window" onClick={handleOpenWindow}>
            <ExternalLink size={16} />
          </button>
          <button className={styles.headerButton} aria-label="Close calendar" onClick={() => onOpenChange(false)}>
            <X size={16} />
          </button>
        </div>
      </div>

      <div className={styles.body}>
        {selectedEvent && selectedKind ? (
          <EventDetailPanel
            event={selectedEvent}
            kind={selectedKind}
            accountId={accountId}
            onBack={handleBackFromDetail}
            onOpenMessage={onOpenMessage ? (id) => { onOpenMessage(id); onOpenChange(false); } : undefined}
            onFindRelatedByInviteUid={onFindRelatedByInviteUid ? (uid) => {
              onFindRelatedByInviteUid(uid);
              onOpenChange(false);
            } : undefined}
            onEventUpdated={handleEventUpdated}
          />
        ) : (
          <CalendarView
            accountId={accountId}
            calendarRef={calendarRef}
            onEventClick={handleEventClick}
            onCreateEvent={(start, end, allDay) => {
              setCreateStart(start);
              setCreateEnd(end);
              setCreateAllDay(allDay);
              setEventDialogOpen(true);
            }}
          />
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        className="bottom-center-time"
        style={{ cursor: "pointer", background: "none", border: "none", padding: 0, color: "inherit", font: "inherit" }}
        title="Open calendar"
        aria-label="Open calendar"
        onClick={() => onOpenChange(!open)}
      >
        {triggerLabel}
      </button>

      {typeof document !== "undefined" && panel ? createPortal(panel, document.querySelector(".radix-themes") ?? document.body) : null}

      <EventDialog
        open={eventDialogOpen}
        accountId={accountId}
        defaultStart={createStart}
        defaultEnd={createEnd}
        defaultAllDay={createAllDay}
        onClose={() => setEventDialogOpen(false)}
        onSaved={handleEventSaved}
      />
    </>
  );
}
