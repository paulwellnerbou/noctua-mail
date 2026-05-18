"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import {
  dataTransferHasIcs,
  postIcsImport,
  readIcsSourcesFromDataTransfer
} from "@/lib/calendarImportClient";
import { dispatchCalendarEventsUpdatedEvent } from "./calendarEventsClient";

export type CalendarIcsDropStatus =
  | { kind: "idle" }
  | { kind: "importing" }
  | { kind: "success" }
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
 * Wires up an HTML element as a drop target for `.ics` files. Reads the
 * dropped file(s) (or inline text/calendar payload), POSTs each to
 * `/api/calendar/import`, and dispatches the calendar-events-updated event
 * so every mounted CalendarView re-fetches from the server.
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

      let sources: string[];
      try {
        sources = await readIcsSourcesFromDataTransfer(event.dataTransfer);
      } catch (error) {
        setStatus({
          kind: "error",
          message: error instanceof Error ? error.message : "Could not read the dropped file."
        });
        return;
      }
      if (sources.length === 0) {
        // The user dropped files but none were .ics — silently ignore, the
        // user can drop again with a real calendar file. Only surface an
        // error when a non-file payload (e.g. inline text/calendar) had no
        // usable content.
        if (droppedFileCount > 0) return;
        setStatus({ kind: "error", message: "No .ics data in the dropped content." });
        return;
      }

      setStatus({ kind: "importing" });
      let importedAny = false;
      const errors: string[] = [];
      try {
        for (const source of sources) {
          const result = await postIcsImport(source, accountId);
          if (result.ok) {
            importedAny = true;
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
      if (importedAny) {
        // Notify every mounted CalendarView so they refetch from the server.
        // (FullCalendar's getApi().refetchEvents() doesn't help here — the
        // view is React-state-driven and listens for this custom event.)
        dispatchCalendarEventsUpdatedEvent();
        if (errors.length === 0) {
          setStatus({ kind: "success" });
        } else {
          setStatus({
            kind: "error",
            message: `Partial import (${errors.length} failed): ${errors[0]}`
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
