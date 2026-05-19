"use client";

import { Clock, MapPin, Repeat, User, Users } from "lucide-react";
import { parseHttpUrl } from "@/lib/url";
import CalendarMetaRow from "./CalendarMetaRow";
import styles from "./EventDetailView.module.css";

export type EventDetailMetaProps = {
  timeRange: string;
  tzLabel: string | null;
  location?: string;
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
  recurrenceSummary,
  organizer,
  attendees
}: EventDetailMetaProps) {
  const locationUrl = parseHttpUrl(location);
  return (
    <>
      {timeRange && (
        <CalendarMetaRow icon={Clock}>
          {timeRange}
          {tzLabel ? <span className={styles.tzLabel}> ({tzLabel})</span> : null}
        </CalendarMetaRow>
      )}
      {location && (
        <CalendarMetaRow icon={MapPin}>
          {locationUrl ? (
            <a
              className={styles.locationLink}
              href={locationUrl}
              target="_blank"
              rel="noreferrer"
            >
              {location}
            </a>
          ) : (
            location
          )}
        </CalendarMetaRow>
      )}
      {recurrenceSummary && <CalendarMetaRow icon={Repeat}>{recurrenceSummary}</CalendarMetaRow>}
      {organizer && (
        <CalendarMetaRow icon={User} iconSize={14} variant="wrap" label="Organizer">
          {organizer}
        </CalendarMetaRow>
      )}
      {attendees && attendees.length > 0 && (
        <CalendarMetaRow icon={Users} iconSize={14} variant="wrap" label="Attendees">
          {attendees.join(", ")}
        </CalendarMetaRow>
      )}
    </>
  );
}
