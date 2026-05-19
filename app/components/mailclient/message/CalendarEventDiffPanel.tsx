import { useEffect, useState } from "react";
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
import { buildAccountMessageCalendarDiffPath } from "@/lib/accountApiPaths";
import type { AccountDateFormat } from "@/lib/data";
import CalendarMetaRow from "@/app/components/calendar/CalendarMetaRow";
import styles from "./CalendarEventDiffPanel.module.css";

type DiffEntry = {
  eventUid: string;
  priorMessageId?: string | null;
  diff: CalendarEventDiff;
};

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

async function loadDiffs(accountId: string, messageId: string): Promise<DiffEntry[]> {
  const response = await fetch(buildAccountMessageCalendarDiffPath(accountId, messageId), {
    credentials: "include"
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { ok?: boolean; diffs?: DiffEntry[] };
  return body.ok ? body.diffs ?? [] : [];
}

function RowContent({ row }: { row: DiffRow }) {
  if (row.before && row.after) {
    return (
      <>
        <span className={styles.before}>{row.before}</span>{" "}
        <span className={styles.arrow}>→</span>{" "}
        <span className={styles.after}>{row.after}</span>
      </>
    );
  }
  const text = row.after ?? row.before;
  const className =
    row.variant === "added" ? styles.added : row.variant === "removed" ? styles.removed : undefined;
  return <span className={className}>{text}</span>;
}

/**
 * "What changed" panel rendered above an UPDATE/CANCEL calendar event card.
 * Pulls the per-message diff endpoint and renders one CalendarMetaRow per
 * change so the panel blends visually into the event card below.
 */
export default function CalendarEventDiffPanel({
  accountId,
  messageId,
  eventUid,
  dateFormat
}: {
  accountId: string;
  messageId: string;
  eventUid: string;
  dateFormat?: AccountDateFormat;
}) {
  const [entry, setEntry] = useState<DiffEntry | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadDiffs(accountId, messageId)
      .then((entries) => {
        if (cancelled) return;
        const normalized = eventUid.trim().toLowerCase();
        setEntry(
          entries.find((e) => e.eventUid.trim().toLowerCase() === normalized) ?? null
        );
      })
      .catch(() => {
        if (!cancelled) setEntry(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, messageId, eventUid]);

  if (entry === undefined || entry === null) return null;
  const { diff } = entry;
  if (diff.kind === "initial" || diff.kind === "no-change") return null;

  if (diff.kind === "unavailable") {
    return (
      <section className={styles.panel} aria-label="Calendar update changes">
        <p className={styles.heading}>What changed</p>
        <p className={styles.muted}>
          The previous version of this invite isn&rsquo;t available locally, so we can&rsquo;t
          show what changed.
        </p>
      </section>
    );
  }

  const rows = buildDiffRows(diff, dateFormat);
  const isCancel = diff.kind === "cancel";

  return (
    <section className={styles.panel} aria-label="Calendar update changes">
      <p className={styles.heading}>{isCancel ? "Event cancelled" : "What changed"}</p>
      {rows.length === 0 && !isCancel ? (
        <p className={styles.muted}>
          The organizer sent an update but nothing visible changed (likely a re-sync).
        </p>
      ) : (
        rows.map((row) => (
          <div key={row.key} className={row.indent ? styles.indent : undefined}>
            <CalendarMetaRow icon={ICONS[row.icon]} label={row.label}>
              <RowContent row={row} />
            </CalendarMetaRow>
          </div>
        ))
      )}
    </section>
  );
}
