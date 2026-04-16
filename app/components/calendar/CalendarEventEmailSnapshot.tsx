"use client";

import { Card } from "@radix-ui/themes";
import type { AccountDateFormat } from "@/lib/data";
import { formatAccountMediumDateTime } from "@/lib/dateFormatting";
import {
  hasCalendarEventEmailSnapshot,
  type CalendarEventEmailSnapshot as CalendarEventEmailSnapshotData
} from "@/lib/calendarEventEmailSnapshot";
import { enforceSafeLinks, sanitizeHtmlForDisplay, stripStyleTags } from "@/lib/html";
import styles from "./CalendarEventEmailSnapshot.module.css";

export type { CalendarEventEmailSnapshotData };

type Props = {
  snapshot: CalendarEventEmailSnapshotData;
  dateFormat?: AccountDateFormat;
  className?: string;
};

function trim(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Renders the snapshot of the email that spawned a calendar event. Intended
 * to sit below the event detail in the right-pane thread view.
 *
 * Loose visual kinship with ThreadMessageCard (Radix Card + subject-first
 * typography), but no attachments, no action menu, no badges for
 * folders/categories/tags/topics — per the Topic 2 spec.
 *
 * Renders nothing (returns null) when every snapshot field is empty. The
 * surrounding layout should not show any heading unless this component
 * actually outputs content.
 */
export default function CalendarEventEmailSnapshot({
  snapshot,
  dateFormat,
  className
}: Props) {
  if (!hasCalendarEventEmailSnapshot(snapshot)) {
    return null;
  }

  const subject = trim(snapshot.sourceSubject);
  const from = trim(snapshot.sourceFromAddr);
  const to = trim(snapshot.sourceToAddr);
  const cc = trim(snapshot.sourceCcAddr);
  const bcc = trim(snapshot.sourceBccAddr);
  const bodyHtml = trim(snapshot.sourceBodyHtml);
  const bodyText = trim(snapshot.sourceBodyText);
  const dateLabel =
    typeof snapshot.sourceDateMs === "number"
      ? formatAccountMediumDateTime(snapshot.sourceDateMs, dateFormat) ?? null
      : null;

  // Prefer HTML, fall back to text. Sanitize through the same pipeline used
  // by the regular message viewer, then enforce safe link attributes (so
  // external links carry `rel="noopener noreferrer"` and open in a new
  // tab — preventing reverse-tabnabbing). This is display-only — no link
  // preview, no font rescaling, no inline image resolution (we intentionally
  // don't store attachments with the snapshot).
  const renderedHtml = bodyHtml
    ? enforceSafeLinks(sanitizeHtmlForDisplay(stripStyleTags(bodyHtml)))
    : null;

  const rootClassName = className ? `${styles.card} ${className}` : styles.card;

  return (
    <Card className={rootClassName} data-testid="calendar-event-email-snapshot">
      <div className={styles.header}>
        <div className={styles.label}>Original email</div>
        {subject && <div className={styles.subjectLine}>{subject}</div>}
        {dateLabel && <div className={styles.date}>{dateLabel}</div>}
      </div>
      {(from || to || cc || bcc) && (
        <div className={styles.addresses}>
          {from && (
            <div className={styles.addressRow}>
              <span className={styles.addressLabel}>From</span>
              <span className={styles.addressValue}>{from}</span>
            </div>
          )}
          {to && (
            <div className={styles.addressRow}>
              <span className={styles.addressLabel}>To</span>
              <span className={styles.addressValue}>{to}</span>
            </div>
          )}
          {cc && (
            <div className={styles.addressRow}>
              <span className={styles.addressLabel}>Cc</span>
              <span className={styles.addressValue}>{cc}</span>
            </div>
          )}
          {bcc && (
            <div className={styles.addressRow}>
              <span className={styles.addressLabel}>Bcc</span>
              <span className={styles.addressValue}>{bcc}</span>
            </div>
          )}
        </div>
      )}
      {renderedHtml ? (
        <div
          className={styles.body}
          // sanitizeHtmlForDisplay is the standard viewer sanitizer.
          dangerouslySetInnerHTML={{ __html: renderedHtml }}
        />
      ) : bodyText ? (
        <div className={`${styles.body} ${styles.bodyText}`}>{bodyText}</div>
      ) : null}
    </Card>
  );
}
