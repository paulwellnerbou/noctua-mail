"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./EventDetailView.module.css";

/**
 * One line of read-only event metadata: a leading icon, an optional inline
 * label ("Organizer:"), and the value. Two variants:
 *
 * - "inline" (default): baseline-aligned, used for short single-line values
 *   like the time range or location.
 * - "wrap": top-aligned, used when the value may wrap (attendee lists,
 *   long descriptions).
 *
 * Shared by EventDetailMeta and CalendarEventDiffPanel so the diff panel
 * blends visually into the event card below it.
 */
export type CalendarMetaRowProps = {
  icon: LucideIcon;
  iconSize?: number;
  label?: string;
  variant?: "inline" | "wrap";
  children: ReactNode;
};

export default function CalendarMetaRow({
  icon: Icon,
  iconSize = 12,
  label,
  variant = "inline",
  children
}: CalendarMetaRowProps) {
  if (variant === "wrap") {
    return (
      <div className={styles.metaRowWrap}>
        <Icon size={iconSize} className={styles.metaIcon} aria-hidden />
        <span className={styles.metaText}>
          {label ? (
            <>
              <span className={styles.metaInlineLabel}>{label}:</span>{" "}
            </>
          ) : null}
          {children}
        </span>
      </div>
    );
  }
  return (
    <div className={styles.metaRow}>
      <Icon size={iconSize} aria-hidden />
      {label ? <span className={styles.metaInlineLabel}>{label}:</span> : null}
      <span>{children}</span>
    </div>
  );
}
