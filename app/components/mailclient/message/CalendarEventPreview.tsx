import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, MapPin } from "lucide-react";
import { Badge } from "@radix-ui/themes";
import type { Attachment } from "@/lib/data";
import { parseIcsEvents, type CalendarEventPreview } from "@/lib/calendar";
import { isCalendarAttachment } from "@/lib/messageFlags";
import styles from "./CalendarEventPreview.module.css";

function readDataUrl(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex < 0) return "";
  const header = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  if (header.includes(";base64")) {
    try {
      return atob(payload);
    } catch {
      return "";
    }
  }
  try {
    return decodeURIComponent(payload);
  } catch {
    return payload;
  }
}

function formatEventDate(
  date?: Date,
  allDay = false,
  timezone?: string
) {
  if (!date) return "";
  const options: Intl.DateTimeFormatOptions = allDay
    ? { dateStyle: "medium" }
    : { dateStyle: "medium", timeStyle: "short", ...(timezone ? { timeZone: timezone } : {}) };
  try {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  } catch {
    const fallbackOptions: Intl.DateTimeFormatOptions = allDay
      ? { dateStyle: "medium" }
      : { dateStyle: "medium", timeStyle: "short" };
    return new Intl.DateTimeFormat(undefined, fallbackOptions).format(date);
  }
}

function formatDateRange(event: CalendarEventPreview) {
  const start = formatEventDate(event.start, event.allDay, event.startTimezone);
  const end = formatEventDate(event.end, event.allDay, event.endTimezone);
  if (!start) return "";
  if (!end) return start;
  return `${start} - ${end}`;
}

function parseHttpUrl(value?: string) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export default function CalendarEventPreview({ attachments }: { attachments: Attachment[] }) {
  const attachment = useMemo(
    () => attachments.find((item) => isCalendarAttachment(item) && Boolean(item.url || item.dataUrl)) ?? null,
    [attachments]
  );
  const [result, setResult] = useState<{
    attachmentId: string;
    events: CalendarEventPreview[];
    error: boolean;
  }>({
    attachmentId: "",
    events: [],
    error: false
  });

  useEffect(() => {
    let active = true;
    if (!attachment) return;
    const load = async () => {
      try {
        const source = attachment.dataUrl
          ? readDataUrl(attachment.dataUrl)
          : attachment.url
            ? await fetch(attachment.url).then((res) => (res.ok ? res.text() : ""))
            : "";
        if (!active) return;
        const parsed = parseIcsEvents(source);
        setResult({
          attachmentId: attachment.id,
          events: parsed,
          error: parsed.length === 0
        });
      } catch {
        if (!active) return;
        setResult({
          attachmentId: attachment.id,
          events: [],
          error: true
        });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [attachment]);

  if (!attachment) return null;
  const hasCurrentResult = result.attachmentId === attachment.id;
  const events = hasCurrentResult ? result.events : [];
  const loading = !hasCurrentResult;
  const hasError = hasCurrentResult && result.error;

  const downloadFilename = (() => {
    const name = attachment.filename || "invite.ics";
    return name.toLowerCase().endsWith(".ics") ? name : `${name}.ics`;
  })();

  return (
    <section className={styles.preview}>
      <div className={styles.header}>
        <div className={styles.title}>
          <CalendarDays size={14} />
          <span>Calendar Event</span>
        </div>
        <a
          href={attachment.url ?? attachment.dataUrl ?? "#"}
          style={{ textDecoration: "none" }}
          onClick={(event) => {
            if (!attachment.url && !attachment.dataUrl) {
              event.preventDefault();
            }
          }}
        >
          <Badge size="1" variant="soft" color="indigo" style={{ cursor: "pointer" }}>
            {downloadFilename}
          </Badge>
        </a>
      </div>
      {loading ? (
        <p className={styles.meta}>Loading event preview…</p>
      ) : hasError || events.length === 0 ? (
        <p className={styles.meta}>Could not parse calendar event details.</p>
      ) : (
        <div className={styles.eventList}>
          {events.slice(0, 3).map((event, index) => {
            const dateRange = formatDateRange(event);
            const locationUrl = parseHttpUrl(event.location);
            return (
              <article key={event.uid ?? `${attachment.id}-${index}`} className={styles.event}>
                <h5 className={styles.eventTitle}>{event.summary || "Untitled Event"}</h5>
                {dateRange ? (
                  <div className={styles.metaRow}>
                    <Clock size={12} />
                    <span>{dateRange}</span>
                  </div>
                ) : null}
                {event.location ? (
                  <div className={styles.metaRow}>
                    <MapPin size={12} />
                    {locationUrl ? (
                      <a className={styles.locationLink} href={locationUrl} target="_blank" rel="noreferrer">
                        {event.location}
                      </a>
                    ) : (
                      <span>{event.location}</span>
                    )}
                  </div>
                ) : null}
                {event.organizer ? <p className={styles.meta}>Organizer: {event.organizer}</p> : null}
              </article>
            );
          })}
          {events.length > 3 ? (
            <p className={styles.meta}>+{events.length - 3} more events in attachment</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
