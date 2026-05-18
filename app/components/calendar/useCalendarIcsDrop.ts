"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import {
  dataTransferHasIcs,
  postIcsImport,
  readIcsSourcesFromDataTransfer
} from "@/lib/calendarImportClient";

export type CalendarIcsDropStatus =
  | { kind: "idle" }
  | { kind: "importing" }
  | { kind: "success" }
  | { kind: "error"; message: string };

type Options = {
  accountId: string;
  /** Called once after at least one ICS source has been successfully imported. */
  onImported: () => void;
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
 * `/api/calendar/import`, and calls `onImported` once at least one succeeded
 * so the caller can refetch its FullCalendar.
 */
export function useCalendarIcsDrop({ accountId, onImported }: Options): CalendarIcsDropApi {
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
      dragDepthRef.current = 0;
      setIsDragOver(false);

      const sources = await readIcsSourcesFromDataTransfer(event.dataTransfer);
      if (sources.length === 0) {
        setStatus({ kind: "error", message: "No .ics file in the dropped content." });
        return;
      }

      setStatus({ kind: "importing" });
      let importedAny = false;
      let lastError: string | null = null;
      for (const source of sources) {
        const result = await postIcsImport(source, accountId);
        if (result.ok) importedAny = true;
        else lastError = result.message ?? "Import failed";
      }
      if (importedAny) {
        setStatus({ kind: "success" });
        onImported();
      } else {
        setStatus({ kind: "error", message: lastError ?? "Import failed" });
      }
    },
    [accountId, onImported]
  );

  const resetStatus = useCallback(() => setStatus({ kind: "idle" }), []);

  return {
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
    isDragOver,
    status,
    resetStatus
  };
}
