import { useEffect, useState, type ReactNode } from "react";
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
  Users
} from "lucide-react";
import type { CalendarEventDiff } from "@/lib/calendarEventDiff";
import {
  describeOccurrence,
  renderAttendeeDiff,
  renderBaseFieldDiff,
  type RenderableChange
} from "@/lib/calendarEventDiffFormat";
import { buildAccountMessageCalendarDiffPath } from "@/lib/accountApiPaths";
import type { AccountDateFormat } from "@/lib/data";
import styles from "./CalendarEventDiffPanel.module.css";

type DiffEntry = {
  eventUid: string;
  priorMessageId?: string | null;
  diff: CalendarEventDiff;
};

type ApiResponse =
  | { ok: true; diffs: DiffEntry[] }
  | { ok: false; message?: string };

async function loadDiffs(accountId: string, messageId: string): Promise<DiffEntry[]> {
  const response = await fetch(buildAccountMessageCalendarDiffPath(accountId, messageId), {
    credentials: "include"
  });
  if (!response.ok) return [];
  const body = (await response.json()) as ApiResponse;
  if (!("ok" in body) || !body.ok) return [];
  return body.diffs ?? [];
}

const ICON_SIZE = 12;

const ICON_BY_LABEL: Record<string, ReactNode> = {
  Title: <Tag size={ICON_SIZE} />,
  Location: <MapPin size={ICON_SIZE} />,
  Status: <CalendarCheck size={ICON_SIZE} />,
  Start: <Clock size={ICON_SIZE} />,
  End: <Clock size={ICON_SIZE} />,
  "Time zone (start)": <Globe size={ICON_SIZE} />,
  "Time zone (end)": <Globe size={ICON_SIZE} />,
  "All day": <CalendarCheck size={ICON_SIZE} />,
  Description: <FileText size={ICON_SIZE} />,
  Recurrence: <Repeat size={ICON_SIZE} />,
  "Extra dates added": <CalendarClock size={ICON_SIZE} />,
  "Extra dates removed": <CalendarClock size={ICON_SIZE} />,
  "Occurrences cancelled": <CalendarX size={ICON_SIZE} />,
  "Cancellations undone": <CalendarClock size={ICON_SIZE} />,
  Organizer: <User size={ICON_SIZE} />
};

function iconForLabel(label: string): ReactNode {
  return ICON_BY_LABEL[label] ?? <Tag size={ICON_SIZE} />;
}

function ChangeRow({ row }: { row: RenderableChange }) {
  return (
    <li className={styles.row}>
      <span className={styles.icon} aria-hidden>
        {iconForLabel(row.label)}
      </span>
      <span>
        <span className={styles.label}>{row.label}:</span>{" "}
        {row.before && row.after ? (
          <>
            <span className={styles.before}>{row.before}</span>{" "}
            <span className={styles.arrow}>→</span>{" "}
            <span className={styles.after}>{row.after}</span>
          </>
        ) : row.after ? (
          <span className={styles.after}>{row.after}</span>
        ) : row.before ? (
          <span className={styles.before}>{row.before}</span>
        ) : null}
      </span>
    </li>
  );
}

/**
 * "What changed" panel rendered above an UPDATE/CANCEL calendar event card.
 * Pulls the per-message diff endpoint once and looks up the entry for the
 * specific eventUid this card represents.
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
        const match = entries.find((e) => e.eventUid.trim().toLowerCase() === normalized) ?? null;
        setEntry(match);
      })
      .catch(() => {
        if (!cancelled) setEntry(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, messageId, eventUid]);

  if (entry === undefined) return null;
  if (entry === null) return null;
  const { diff } = entry;
  if (diff.kind === "initial") return null;
  if (diff.kind === "no-change") return null;
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

  const baseRows = renderBaseFieldDiff(diff.base, dateFormat);
  const attendees = renderAttendeeDiff(diff);
  const occurrences = diff.occurrences.map((occ) => describeOccurrence(occ, dateFormat));
  const isCancel = diff.kind === "cancel";

  return (
    <section className={styles.panel} aria-label="Calendar update changes">
      <p className={styles.heading}>{isCancel ? "Event cancelled" : "What changed"}</p>

      {baseRows.length === 0 && attendees.length === 0 && occurrences.length === 0 && !isCancel ? (
        <p className={styles.muted}>
          The organizer sent an update but nothing visible changed (likely a re-sync).
        </p>
      ) : null}

      {baseRows.length > 0 ? (
        <ul className={styles.list}>
          {baseRows.map((row, i) => (
            <ChangeRow key={`base-${i}-${row.label}`} row={row} />
          ))}
        </ul>
      ) : null}

      {attendees.length > 0 ? (
        <ul className={styles.list}>
          {attendees.map((bucket, i) => (
            <li key={`att-${i}`} className={styles.row}>
              <span className={styles.icon} aria-hidden>
                <Users size={ICON_SIZE} />
              </span>
              <span
                className={
                  bucket.kind === "added"
                    ? styles.added
                    : bucket.kind === "removed"
                      ? styles.removed
                      : undefined
                }
              >
                {bucket.kind === "added" ? "+ " : bucket.kind === "removed" ? "− " : ""}
                {bucket.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {occurrences.length > 0 ? (
        <ul className={styles.list}>
          {occurrences.map((occ) => (
            <li key={occ.recurrenceIdMs} className={styles.row}>
              <span className={styles.icon} aria-hidden>
                <CalendarClock size={ICON_SIZE} />
              </span>
              <span>
                {occ.primary}
                {occ.details.length > 0 ? (
                  <ul className={styles.occurrenceList}>
                    {occ.details.map((detail, i) => (
                      <ChangeRow key={`occ-${occ.recurrenceIdMs}-${i}`} row={detail} />
                    ))}
                  </ul>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
