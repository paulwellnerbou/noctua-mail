"use client";

import { Clock, MapPin, Repeat, User, Users } from "lucide-react";
import styles from "./EventDetailView.module.css";

export type EventDetailMetaProps = {
  timeRange: string;
  tzLabel: string | null;
  location?: string;
  locationUrl: string | null;
  recurrenceSummary: string | null;
  organizer?: string;
  attendees?: string[];
};

/**
 * Read-only meta rows for a calendar event: time/timezone, location (with
 * optional link), human-readable recurrence summary, organizer and attendees.
 * Rows render only when their underlying value is present.
 */
export default function EventDetailMeta({
  timeRange,
  tzLabel,
  location,
  locationUrl,
  recurrenceSummary,
  organizer,
  attendees
}: EventDetailMetaProps) {
  return (
    <>
      {timeRange && (
        <div className={styles.metaRow}>
          <Clock size={12} />
          <span>{timeRange}</span>
          {tzLabel && <span className={styles.tzLabel}>({tzLabel})</span>}
        </div>
      )}

      {location && (
        <div className={styles.metaRow}>
          <MapPin size={12} />
          {locationUrl ? (
            <a className={styles.locationLink} href={locationUrl} target="_blank" rel="noreferrer">
              {location}
            </a>
          ) : (
            <span>{location}</span>
          )}
        </div>
      )}

      {recurrenceSummary && (
        <div className={styles.metaRow}>
          <Repeat size={12} />
          <span>{recurrenceSummary}</span>
        </div>
      )}

      {organizer && (
        <div className={styles.metaRowWrap}>
          <User size={14} className={styles.metaIcon} aria-hidden />
          <span className={styles.metaText}>
            <span className={styles.metaInlineLabel}>Organizer:</span> {organizer}
          </span>
        </div>
      )}

      {attendees && attendees.length > 0 && (
        <div className={styles.metaRowWrap}>
          <Users size={14} className={styles.metaIcon} aria-hidden />
          <span className={styles.metaText}>
            <span className={styles.metaInlineLabel}>Attendees:</span> {attendees.join(", ")}
          </span>
        </div>
      )}
    </>
  );
}
