"use client";

import { useEffect } from "react";
import type { CalendarIcsDropStatus } from "./useCalendarIcsDrop";
import styles from "./CalendarDropOverlay.module.css";

type Props = {
  isDragOver: boolean;
  status: CalendarIcsDropStatus;
  onResetStatus: () => void;
};

export default function CalendarDropOverlay({ isDragOver, status, onResetStatus }: Props) {
  // Auto-clear transient success/error messages so the overlay doesn't hang
  // around once the user has seen the result.
  useEffect(() => {
    if (status.kind !== "success" && status.kind !== "error") return;
    // Success messages now carry event details (title + date), so give the
    // user a few seconds to actually read them before fading.
    const ms = status.kind === "success" ? 4000 : 6000;
    const handle = window.setTimeout(onResetStatus, ms);
    return () => window.clearTimeout(handle);
  }, [status, onResetStatus]);

  const message =
    status.kind === "importing"
      ? "Importing calendar file…"
      : status.kind === "success"
        ? status.message
        : status.kind === "error"
          ? status.message
          : isDragOver
            ? "Drop .ics file to import"
            : null;

  if (!message) return null;
  const isError = status.kind === "error";
  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <div className={`${styles.message} ${isError ? styles.errorMessage : ""}`}>{message}</div>
    </div>
  );
}
