"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import {
  dataTransferHasIcs,
  formatImportedEntriesMessage,
  postIcsImport,
  readIcsSourcesFromDataTransfer,
  type IcsImportEntry,
  type ReadIcsSourcesResult
} from "@/lib/calendarImportClient";
import { dispatchCalendarRemindersUpdatedEvent } from "@/app/components/mailclient/utils/calendarReminders";
import { dispatchCalendarEventsUpdatedEvent } from "./calendarEventsClient";

export type CalendarIcsDropStatus =
  | { kind: "idle" }
  | { kind: "importing" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type Options = {
  accountId: string;
};

type DropHandlers = {
  onDragEnter: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
};

export type CalendarIcsDropApi = {
  dropProps: DropHandlers;
  isDragOver: boolean;
  status: CalendarIcsDropStatus;
  /** Clear a transient success/error message (e.g. after a timeout). */
  resetStatus: () => void;
};

/**
 * Wires up an HTML element as a drop target for `.ics` files. On successful
 * import the hook:
 *   1. Reads the dropped file(s) (or inline text/calendar payload)
 *   2. POSTs each to `/api/calendar/import`
 *   3. Dispatches `noctua:calendar-events-updated` so every mounted CalendarView
 *      re-fetches from the server
 *   4. Dispatches `noctua:calendar-reminders-updated` so pending-reminders
 *      state and notification dedup refresh immediately (otherwise stale
 *      until the next 60s poll)
 *   5. Sets a transient success/error status pill rendered by CalendarDropOverlay
 */
export function useCalendarIcsDrop({ accountId }: Options): CalendarIcsDropApi {
  const [isDragOver, setIsDragOver] = useState(false);
  const [status, setStatus] = useState<CalendarIcsDropStatus>({ kind: "idle" });
  // dragenter / dragleave both fire on every descendant the cursor crosses,
  // not just the outer container. Counting depth lets us flip `isDragOver`
  // off only when the cursor has truly left the outer element instead of
  // flickering as the user moves across child elements (e.g. FullCalendar's
  // many grid cells).
  const dragDepthRef = useRef(0);

  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (!dataTransferHasIcs(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    if (dragDepthRef.current === 1) {
      setIsDragOver(true);
      // The previous drop's success/error pill takes priority over the
      // hover prompt in CalendarDropOverlay, so an old pill could shadow
      // "Drop .ics file to import" while the user is dragging again.
      // Clear those transient kinds (but keep "importing" intact in case
      // a second drag happens while an earlier import is still in flight).
      setStatus((prev) =>
        prev.kind === "success" || prev.kind === "error" ? { kind: "idle" } : prev
      );
    }
  }, []);

  const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    // Required to allow the drop. dragover fires continuously, so we use it
    // only to advertise the drop effect — depth tracking happens in enter/leave.
    if (!dataTransferHasIcs(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeave = useCallback(() => {
    // We deliberately don't gate this on `dataTransferHasIcs`: some browsers
    // redact dataTransfer details on leave for security, and the depth
    // counter already prevents us from ticking below zero if dragenter
    // never ran for this drag.
    if (dragDepthRef.current === 0) return;
    dragDepthRef.current -= 1;
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const onDrop = useCallback(
    async (event: DragEvent<HTMLElement>) => {
      if (!dataTransferHasIcs(event.dataTransfer)) return;
      event.preventDefault();
      // Remember whether the drop carried any files at all, before we touch
      // dataTransfer asynchronously — readIcsSourcesFromDataTransfer reads
      // .files, but we want to distinguish "no .ics" from "no files dropped".
      const droppedFileCount = event.dataTransfer?.files.length ?? 0;
      dragDepthRef.current = 0;
      setIsDragOver(false);

      let readResult: ReadIcsSourcesResult;
      try {
        readResult = await readIcsSourcesFromDataTransfer(event.dataTransfer);
      } catch (error) {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not read the dropped file."
        });
        return;
      }
      const { sources, matchedIcsFile, emptyIcsFileNames } = readResult;
      if (sources.length === 0) {
        // Tell apart three "no usable content" cases:
        //  - an .ics file was dropped but it was empty → surface error
        //  - non-.ics files were dropped → silently ignore (user can retry)
        //  - inline text/calendar payload was empty   → surface error
        if (matchedIcsFile) {
          const detail =
            emptyIcsFileNames.length > 0 ? `: ${emptyIcsFileNames.join(", ")}` : "";
          setStatus({ kind: "error", message: `The dropped .ics file is empty${detail}.` });
          return;
        }
        if (droppedFileCount > 0) return;
        setStatus({ kind: "error", message: "No .ics data in the dropped content." });
        return;
      }

      setStatus({ kind: "importing" });
      const importedEntries: IcsImportEntry[] = [];
      // Seed errors with any per-file empties so a multi-file drop reports
      // them alongside the partial-success outcome instead of dropping them.
      const errors: string[] = emptyIcsFileNames.map((name) => `${name} is empty`);
      try {
        for (const source of sources) {
          const result = await postIcsImport(source, accountId);
          if (result.ok) {
            if (result.imports) importedEntries.push(...result.imports);
            // The server can succeed overall but report partial per-event
            // failures inside the ICS — surface those too.
            if (result.failures) {
              for (const f of result.failures) errors.push(f.message);
            }
          } else {
            errors.push(result.message ?? "Import failed");
          }
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Import failed");
      }
      if (importedEntries.length > 0) {
        // Notify every mounted CalendarView so they refetch from the server.
        // (FullCalendar's getApi().refetchEvents() doesn't help here — the
        // view is React-state-driven and listens for this custom event.)
        dispatchCalendarEventsUpdatedEvent();
        // Standalone imports reschedule (or cancel) calendar reminders via
        // rescheduleCalendarRemindersByEventUid / cancelCalendarRemindersByEventUid,
        // so the pending-reminders panel and notification dedup state both
        // need to refresh. useReminderNotifications listens for this event
        // (otherwise it'd be stale until the next 60s poll tick).
        dispatchCalendarRemindersUpdatedEvent();
        const summary = formatImportedEntriesMessage(importedEntries);
        if (errors.length === 0) {
          setStatus({ kind: "success", message: summary });
        } else {
          setStatus({
            kind: "error",
            message: `${summary} (${errors.length} failed: ${errors[0]})`
          });
        }
      } else {
        setStatus({ kind: "error", message: errors[0] ?? "Import failed" });
      }
    },
    [accountId]
  );

  const resetStatus = useCallback(() => setStatus({ kind: "idle" }), []);

  return {
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
    isDragOver,
    status,
    resetStatus
  };
}
