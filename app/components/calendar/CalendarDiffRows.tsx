"use client";

import {
  CalendarCheck,
  CalendarClock,
  CalendarX,
  Clock,
  FileText,
  Globe,
  MapPin,
  Repeat,
  Tag,
  User,
  Users,
  type LucideIcon
} from "lucide-react";
import type { CalendarEventDiff } from "@/lib/calendarEventDiff";
import { buildDiffRows, type DiffIcon, type DiffRow } from "@/lib/calendarEventDiffFormat";
import { useAccountDateFormat } from "@/app/components/AccountDateFormatContext";
import CalendarMetaRow from "./CalendarMetaRow";
import styles from "../mailclient/message/CalendarEventDiffPanel.module.css";

const ICONS: Record<DiffIcon, LucideIcon> = {
  title: Tag,
  location: MapPin,
  status: CalendarCheck,
  time: Clock,
  tz: Globe,
  allDay: CalendarCheck,
  description: FileText,
  recurrence: Repeat,
  rdate: CalendarClock,
  exdate: CalendarX,
  organizer: User,
  attendee: Users,
  occurrence: CalendarClock
};

function RowContent({ row }: { row: DiffRow }) {
  const hasBefore = row.before !== undefined;
  const hasAfter = row.after !== undefined;
  if (hasBefore && hasAfter) {
    return (
      <>
        <span className={styles.before}>{row.before}</span>{" "}
        <span className={styles.arrow}>→</span>{" "}
        <span className={styles.after}>{row.after}</span>
      </>
    );
  }
  if (hasBefore) {
    return (
      <>
        <span className={styles.before}>{row.before}</span>{" "}
        <span className={styles.arrow}>→</span>{" "}
        <span className={styles.arrow}>—</span>
      </>
    );
  }
  if (hasAfter) {
    const className =
      row.variant === "added"
        ? styles.added
        : row.variant === "removed"
          ? styles.removed
          : styles.after;
    return <span className={className}>{row.after}</span>;
  }
  return null;
}

/**
 * Renders the field-level rows of a calendar-event diff using the same
 * visualization as the incoming-invite "What changed" panel. Shared by that
 * panel's sibling (the conflict-resolution dialog) so both sides of a CalDAV
 * write-back conflict read identically to an organizer update.
 */
export default function CalendarDiffRows({
  diff,
  timeZone,
  allDay,
  emptyLabel = "No visible changes."
}: {
  diff: CalendarEventDiff | null;
  timeZone?: string;
  allDay?: boolean;
  emptyLabel?: string;
}) {
  const dateFormat = useAccountDateFormat();
  if (!diff || diff.kind === "unavailable") {
    return <p className={styles.muted}>Couldn’t compute the changes for this version.</p>;
  }
  if (diff.kind === "initial" || diff.kind === "no-change") {
    return <p className={styles.muted}>{emptyLabel}</p>;
  }
  const rows = buildDiffRows(diff, dateFormat, timeZone, allDay);
  if (rows.length === 0) {
    return <p className={styles.muted}>{emptyLabel}</p>;
  }
  return (
    <>
      {rows.map((row) => (
        <div key={row.key} className={row.indent ? styles.indent : undefined}>
          <CalendarMetaRow icon={ICONS[row.icon]} label={row.label}>
            <RowContent row={row} />
          </CalendarMetaRow>
        </div>
      ))}
    </>
  );
}
