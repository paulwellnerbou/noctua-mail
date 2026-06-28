"use client";

import { useState } from "react";
import { Callout } from "@radix-ui/themes";
import { TriangleAlert } from "lucide-react";
import { buildAccountCalendarConflictResolvePath } from "@/lib/accountApiPaths";
import { useCalendarConflicts } from "./useCalendarConflicts";
import { dispatchCalendarEventsUpdatedEvent } from "./calendarEventsClient";
import CalendarConflictDialog from "./CalendarConflictDialog";

/**
 * Surfaces unresolved CalDAV write-back conflicts at the top of the calendar
 * pane. Hidden when there are none; clicking opens the resolution dialog.
 */
export default function CalendarConflictBanner({ accountId }: { accountId: string }) {
  const { conflicts, refresh } = useCalendarConflicts(accountId);
  const [open, setOpen] = useState(false);
  const [resolvingEventId, setResolvingEventId] = useState<string | null>(null);

  if (conflicts.length === 0) return null;

  const handleResolve = async (eventId: string, resolution: "local" | "remote") => {
    setResolvingEventId(eventId);
    try {
      const res = await fetch(buildAccountCalendarConflictResolvePath(accountId, eventId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ resolution })
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      // Always refresh so the banner reflects true state (a failed resolve
      // leaves the conflict row in place and it reappears).
      await refresh();
      if (res.ok && body?.ok === true) {
        // Resolution applied (local push or remote adopt); let the rest of the
        // calendar UI re-read.
        dispatchCalendarEventsUpdatedEvent();
      }
    } finally {
      setResolvingEventId(null);
    }
  };

  const count = conflicts.length;
  return (
    <>
      <Callout.Root
        color="amber"
        size="1"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        style={{ cursor: "pointer" }}
      >
        <Callout.Icon>
          <TriangleAlert size={16} />
        </Callout.Icon>
        <Callout.Text>
          {count === 1 ? "1 calendar event" : `${count} calendar events`} changed both here and on
          the server. <strong>Review</strong>
        </Callout.Text>
      </Callout.Root>
      <CalendarConflictDialog
        open={open}
        onOpenChange={setOpen}
        conflicts={conflicts}
        resolvingEventId={resolvingEventId}
        onResolve={handleResolve}
      />
    </>
  );
}
