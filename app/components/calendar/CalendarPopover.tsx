"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import FullCalendar from "@fullcalendar/react";
import { DropdownMenu, Flex, Heading, IconButton } from "@radix-ui/themes";
import { CalendarDays, ExternalLink, MoreVertical, PanelRight, X } from "lucide-react";
import type { CalendarEvent, CalendarReminder } from "@/lib/data";
import { openDetachedWindow } from "@/lib/ui/openDetachedWindow";
import dynamic from "next/dynamic";
import EventDetailPanel from "./EventDetailPanel";
import styles from "./CalendarPopover.module.css";

const CalendarView = dynamic(() => import("./CalendarView"), { ssr: false });

type Props = {
  open: boolean;
  accountId: string;
  firstDay?: 0 | 1;
  onOpenChange: (open: boolean) => void;
  onOpenSidebar: () => void;
  triggerLabel: string;
  onOpenMessage?: (messageId: string) => void;
  onFindRelatedByInviteUid?: (uid: string) => void;
  onRecomputeRelations?: () => Promise<void>;
  isRecomputingRelations?: boolean;
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
  firstDay,
  onOpenChange,
  onOpenSidebar,
  triggerLabel,
  onOpenMessage,
  onFindRelatedByInviteUid,
  onRecomputeRelations,
  isRecomputingRelations
}: Props) {
  const calendarRef = useRef<FullCalendar>(null);
  const [position, setPosition] = useState<Position>(getInitialPosition);
  const dragStateRef = useRef({ active: false, startX: 0, startY: 0, posX: 0, posY: 0 });

  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | CalendarReminder | null>(null);
  const [selectedKind, setSelectedKind] = useState<"event" | "reminder" | null>(null);

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

  const handleRecomputeRelations = async () => {
    if (!onRecomputeRelations) return;
    await onRecomputeRelations();
    calendarRef.current?.getApi().refetchEvents();
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

  const panel = open ? (
    <div
      className={styles.floatingPanel}
      style={{ left: position.x, top: position.y }}
    >
      <Flex align="center" justify="between" className={styles.header} onMouseDown={handleDragStart}>
        <Flex align="center" gap="2">
          <CalendarDays size={14} />
          <Heading size="3">Calendar</Heading>
        </Flex>
        <Flex gap="2" align="center">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton size="1" variant="ghost" color="gray" title="Calendar options" aria-label="Calendar options">
                <MoreVertical size={14} />
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
          <IconButton size="1" variant="ghost" color="gray" title="Open in sidebar" aria-label="Open calendar in sidebar" onClick={handleOpenSidebar}>
            <PanelRight size={14} />
          </IconButton>
          <IconButton size="1" variant="ghost" color="gray" title="Open in window" aria-label="Open calendar in window" onClick={handleOpenWindow}>
            <ExternalLink size={14} />
          </IconButton>
          <IconButton size="1" variant="ghost" color="gray" aria-label="Close calendar" onClick={() => onOpenChange(false)}>
            <X size={14} />
          </IconButton>
        </Flex>
      </Flex>

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
            firstDay={firstDay}
            onEventClick={handleEventClick}
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
    </>
  );
}
