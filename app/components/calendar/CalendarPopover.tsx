"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type FullCalendar from "@fullcalendar/react";
import { DropdownMenu, Flex, Heading, IconButton } from "@radix-ui/themes";
import { CalendarDays, ExternalLink, MoreVertical, PanelRight, X } from "lucide-react";
import { openDetachedWindow } from "@/lib/ui/openDetachedWindow";
import CalendarEventBrowser from "./CalendarEventBrowser";
import styles from "./CalendarPopover.module.css";
import {
  computeResizedRect,
  cursorFor,
  isNorth,
  isWest,
  type ResizeHandle,
  type Rect
} from "./calendarPopoverResize";

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

const ALL_HANDLES: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/** Max size bounds for a resize, given which edges can move for `handle`. */
function computeResizeMaxSize(handle: ResizeHandle, startRect: Rect): Size {
  // The east edge can expand up to viewport.w - margin.
  // If we're dragging the west edge, the east edge is anchored, so max width
  // is determined by how far the west edge can travel (toward x = margin).
  const maxW = isWest(handle)
    ? Math.max(MIN_WIDTH, startRect.x + startRect.width - VIEWPORT_MARGIN)
    : Math.max(MIN_WIDTH, window.innerWidth - startRect.x - VIEWPORT_MARGIN);
  const maxH = isNorth(handle)
    ? Math.max(MIN_HEIGHT, startRect.y + startRect.height - VIEWPORT_MARGIN)
    : Math.max(MIN_HEIGHT, window.innerHeight - startRect.y - VIEWPORT_MARGIN);
  return { width: maxW, height: maxH };
}

/** Max size bounds for keyboard-driven SE-corner resize (legacy behavior). */
function computeKeyboardMaxSize(position: Position): Size {
  return {
    width: Math.max(MIN_WIDTH, window.innerWidth - position.x - VIEWPORT_MARGIN),
    height: Math.max(MIN_HEIGHT, window.innerHeight - position.y - VIEWPORT_MARGIN)
  };
}

function getInitialPosition(): Position {
  if (typeof window === "undefined") return { x: 100, y: 100 };
  return {
    x: Math.max(8, (window.innerWidth - PANEL_WIDTH) / 2),
    y: Math.max(8, window.innerHeight - PANEL_HEIGHT - 36)
  };
}

type BodyLockToken = { prevUserSelect: string; prevCursor: string };

function lockBodyForGesture(cursor: string): BodyLockToken {
  const token: BodyLockToken = {
    prevUserSelect: document.body.style.userSelect,
    prevCursor: document.body.style.cursor
  };
  document.body.style.userSelect = "none";
  document.body.style.cursor = cursor;
  return token;
}

function unlockBody(token: BodyLockToken) {
  document.body.style.userSelect = token.prevUserSelect;
  document.body.style.cursor = token.prevCursor;
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
  // Tracks the teardown for whichever pointer gesture is currently active
  // (drag or resize). Cleared when the gesture ends. The component-unmount
  // effect calls this to avoid leaked listeners / a stuck body lock if the
  // popover closes mid-gesture.
  const activeGestureCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (activeGestureCleanupRef.current) {
        activeGestureCleanupRef.current();
        activeGestureCleanupRef.current = null;
      }
    };
  }, []);

  // Drag handling (move the whole panel).
  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button, [role=button]")) return;
    // Only primary button.
    if (e.button !== 0) return;
    // Ignore secondary pointers (multi-touch second-finger, pen + mouse, etc.).
    // Without this, each gesture saves its own snapshot of the body's cursor
    // and user-select — so the second pointer captures the ALREADY-LOCKED
    // state as "original" and restores to that locked state on cleanup,
    // stranding the body in a permanent resize/grabbing cursor.
    if (!e.isPrimary) return;
    // If another gesture is mid-flight, drop this one rather than racing.
    // The active gesture's cleanup will fire on its own pointerup/cancel.
    if (activeGestureCleanupRef.current) return;
    e.preventDefault();

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startPosX = position.x;
    const startPosY = position.y;

    const target = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // setPointerCapture can throw if the target is detached; harmless.
    }
    const lock = lockBodyForGesture("grabbing");

    const onMove = (ev: PointerEvent) => {
      setPosition({
        x: startPosX + (ev.clientX - startClientX),
        y: startPosY + (ev.clientY - startClientY)
      });
    };
    const cleanup = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", cleanup);
      target.removeEventListener("pointercancel", cleanup);
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // Already released; ignore.
      }
      unlockBody(lock);
      if (activeGestureCleanupRef.current === cleanup) {
        activeGestureCleanupRef.current = null;
      }
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", cleanup);
    target.addEventListener("pointercancel", cleanup);
    activeGestureCleanupRef.current = cleanup;
  };

  // Resize handling (all 8 edge/corner handles).
  const handleResizeStart = (handle: ResizeHandle) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    // See `handleDragStart` for the rationale behind the multi-pointer /
    // active-gesture guards — same body-lock restoration hazard applies.
    if (!e.isPrimary) return;
    if (activeGestureCleanupRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startRect: Rect = {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height
    };
    const max = computeResizeMaxSize(handle, startRect);
    const min = { width: MIN_WIDTH, height: MIN_HEIGHT };

    const target = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // ignore
    }
    const cursor = cursorFor(handle);
    const lock = lockBodyForGesture(cursor);

    const onMove = (ev: PointerEvent) => {
      const rect = computeResizedRect({
        handle,
        start: startRect,
        delta: { x: ev.clientX - startClientX, y: ev.clientY - startClientY },
        min,
        max
      });
      setSize({ width: rect.width, height: rect.height });
      if (rect.x !== startRect.x || rect.y !== startRect.y) {
        setPosition({ x: rect.x, y: rect.y });
      }
    };
    const cleanup = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", cleanup);
      target.removeEventListener("pointercancel", cleanup);
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // ignore
      }
      unlockBody(lock);
      if (activeGestureCleanupRef.current === cleanup) {
        activeGestureCleanupRef.current = null;
      }
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", cleanup);
    target.addEventListener("pointercancel", cleanup);
    activeGestureCleanupRef.current = cleanup;
  };

  // Keyboard resize on the SE grip: arrow keys (shift = larger step).
  // Preserved from the original implementation for accessibility.
  const handleResizeKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
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
    const max = computeKeyboardMaxSize(position);
    setSize((prev) => ({
      width: Math.min(max.width, Math.max(MIN_WIDTH, prev.width + deltaW)),
      height: Math.min(max.height, Math.max(MIN_HEIGHT, prev.height + deltaH))
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
      <Flex align="center" justify="between" className={styles.header} onPointerDown={handleDragStart}>
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

      {ALL_HANDLES.map((handle) =>
        // The SE corner is the "real" keyboard-accessible resize control —
        // it's focusable, supports arrow-key resize, and has an aria-label
        // that tells screen-reader users what it does. It's rendered as a
        // `<button>` so assistive tech announces it as an interactive
        // control.
        //
        // The other 7 handles are pure pointer affordances (transparent
        // edge/corner strips) — they duplicate functionality the SE handle
        // already exposes to keyboard users, so they're marked
        // `aria-hidden` to keep them out of the accessibility tree rather
        // than cluttering it with 7 "Resize" nodes that don't add any new
        // capability. `role="separator"` (the previous choice) is for
        // non-interactive dividers and was confusing for AT on an
        // interactive control.
        handle === "se" ? (
          <button
            key={handle}
            type="button"
            className={`${styles.resizeHandle} ${styles[`handle_${handle}`]}`}
            onPointerDown={handleResizeStart(handle)}
            onKeyDown={handleResizeKeyDown}
            aria-label="Resize calendar panel (use arrow keys; hold shift for larger step)"
            title="Resize"
          />
        ) : (
          <div
            key={handle}
            className={`${styles.resizeHandle} ${styles[`handle_${handle}`]}`}
            onPointerDown={handleResizeStart(handle)}
            aria-hidden="true"
          />
        )
      )}
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
