"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type FullCalendar from "@fullcalendar/react";
import { DropdownMenu, Flex, Heading, IconButton } from "@radix-ui/themes";
import { CalendarDays, ExternalLink, MoreVertical, PanelRight, X } from "lucide-react";
import { openDetachedWindow } from "@/lib/ui/openDetachedWindow";
import CalendarEventBrowser from "./CalendarEventBrowser";
import styles from "./CalendarPopover.module.css";

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
type Size = { width: number; height: number };

const PANEL_WIDTH = 860;
const PANEL_HEIGHT = 660;
const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;
const VIEWPORT_MARGIN = 16;
const KEYBOARD_RESIZE_STEP = 20;
const KEYBOARD_RESIZE_STEP_LARGE = 60;

function computeMaxSize(position: Position): { maxW: number; maxH: number } {
  return {
    maxW: Math.max(MIN_WIDTH, window.innerWidth - position.x - VIEWPORT_MARGIN),
    maxH: Math.max(MIN_HEIGHT, window.innerHeight - position.y - VIEWPORT_MARGIN)
  };
}

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
  const [size, setSize] = useState<Size>({ width: PANEL_WIDTH, height: PANEL_HEIGHT });
  const dragStateRef = useRef({ active: false, startX: 0, startY: 0, posX: 0, posY: 0 });
  const resizeStateRef = useRef({ active: false, startX: 0, startY: 0, startWidth: 0, startHeight: 0 });
  // Tracks the teardown for whichever pointer gesture is currently active
  // (drag or resize). Cleared when the gesture ends via mouseup. The
  // component-unmount effect below calls this to avoid leaked document-level
  // listeners and stale setState calls if the popover closes mid-gesture.
  const activeGestureCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (activeGestureCleanupRef.current) {
        activeGestureCleanupRef.current();
        activeGestureCleanupRef.current = null;
      }
    };
  }, []);

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
    const cleanup = () => {
      ds.active = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", cleanup);
      activeGestureCleanupRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", cleanup);
    activeGestureCleanupRef.current = cleanup;
  };

  // Resize handling (bottom-right grip)
  const handleResizeStart = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const rs = resizeStateRef.current;
    rs.active = true;
    rs.startX = e.clientX;
    rs.startY = e.clientY;
    rs.startWidth = size.width;
    rs.startHeight = size.height;

    const onMove = (ev: MouseEvent) => {
      if (!rs.active) return;
      const { maxW, maxH } = computeMaxSize(position);
      setSize({
        width: Math.min(maxW, Math.max(MIN_WIDTH, rs.startWidth + (ev.clientX - rs.startX))),
        height: Math.min(maxH, Math.max(MIN_HEIGHT, rs.startHeight + (ev.clientY - rs.startY)))
      });
    };
    const cleanup = () => {
      rs.active = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", cleanup);
      activeGestureCleanupRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", cleanup);
    activeGestureCleanupRef.current = cleanup;
  };

  // Keyboard resize: focus the grip and use arrow keys (shift = larger step).
  const handleResizeKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? KEYBOARD_RESIZE_STEP_LARGE : KEYBOARD_RESIZE_STEP;
    let deltaW = 0;
    let deltaH = 0;
    switch (e.key) {
      case "ArrowRight": deltaW = step; break;
      case "ArrowLeft":  deltaW = -step; break;
      case "ArrowDown":  deltaH = step; break;
      case "ArrowUp":    deltaH = -step; break;
      default: return;
    }
    e.preventDefault();
    const { maxW, maxH } = computeMaxSize(position);
    setSize((prev) => ({
      width: Math.min(maxW, Math.max(MIN_WIDTH, prev.width + deltaW)),
      height: Math.min(maxH, Math.max(MIN_HEIGHT, prev.height + deltaH))
    }));
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

  const panel = open ? (
    <div
      className={styles.floatingPanel}
      style={{ left: position.x, top: position.y, width: size.width, height: size.height }}
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
        <CalendarEventBrowser
          accountId={accountId}
          firstDay={firstDay}
          calendarRef={calendarRef}
          onOpenMessage={onOpenMessage ? (id) => {
            onOpenMessage(id);
            onOpenChange(false);
          } : undefined}
          onFindRelatedByInviteUid={onFindRelatedByInviteUid ? (uid) => {
            onFindRelatedByInviteUid(uid);
            onOpenChange(false);
          } : undefined}
        />
      </div>

      <button
        type="button"
        className={styles.resizeHandle}
        onMouseDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
        aria-label="Resize calendar panel (use arrow keys; hold shift for larger step)"
        title="Resize"
      />
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
