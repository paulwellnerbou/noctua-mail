import type { CalendarEvent } from "@/lib/data";
import type { CalendarEventPreview } from "@/lib/calendar";
import {
  mergeCalendarParticipation,
  resolveCalendarParticipationFromPreview
} from "@/lib/calendarParticipation";

function formatIcsDate(ms: number, allDay: boolean, timezone?: string): string {
  const date = new Date(ms);
  if (allDay) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  if (timezone) {
    return `TZID=${timezone}:${y}${mo}${dy}T${h}${mi}${s}`;
  }
  return `${y}${mo}${dy}T${h}${mi}${s}Z`;
}

export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  chunks.push(line.slice(0, 75));
  let i = 75;
  while (i < line.length) {
    chunks.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join("\r\n");
}

export function calendarEventToIcs(event: CalendarEvent): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Noctua Mail//Calendar//EN",
    "BEGIN:VEVENT",
    `UID:${event.eventUid}`
  ];

  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}Z`;
  lines.push(`DTSTAMP:${dtstamp}`);

  const dtstart = formatIcsDate(event.startAtMs, event.allDay, event.startTimezone);
  if (event.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${dtstart}`);
  } else if (event.startTimezone) {
    lines.push(`DTSTART;${dtstart}`);
  } else {
    lines.push(`DTSTART:${dtstart}`);
  }

  if (event.endAtMs != null) {
    const dtend = formatIcsDate(event.endAtMs, event.allDay, event.endTimezone);
    if (event.allDay) {
      lines.push(`DTEND;VALUE=DATE:${dtend}`);
    } else if (event.endTimezone) {
      lines.push(`DTEND;${dtend}`);
    } else {
      lines.push(`DTEND:${dtend}`);
    }
  }

  lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }
  if (event.status) {
    lines.push(`STATUS:${event.status.toUpperCase()}`);
  }
  if (event.organizer) {
    lines.push(`ORGANIZER:${escapeIcsText(event.organizer)}`);
  }
  if (event.recurrenceRule) {
    lines.push(`RRULE:${event.recurrenceRule}`);
  }
  if (event.recurrenceDates && event.recurrenceDates.length > 0) {
    const rdates = event.recurrenceDates.map((ms) => formatIcsDate(ms, event.allDay)).join(",");
    lines.push(`RDATE:${rdates}`);
  }
  if (event.excludedDates && event.excludedDates.length > 0) {
    const exdates = event.excludedDates.map((ms) => formatIcsDate(ms, event.allDay)).join(",");
    lines.push(`EXDATE:${exdates}`);
  }

  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  return lines.map(foldLine).join("\r\n");
}

export function calendarPreviewToDbEvent(
  preview: CalendarEventPreview,
  accountId: string,
  sourceType: CalendarEvent["sourceType"],
  extra?: {
    calendarId?: string;
    remoteEtag?: string;
    remoteHref?: string;
    rawIcs?: string;
    messageId?: string;
    accountEmail?: string;
  }
): CalendarEvent {
  function generateId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `cal-${crypto.randomUUID()}`;
    }
    return `cal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const now = Date.now();
  const participation = mergeCalendarParticipation(
    undefined,
    resolveCalendarParticipationFromPreview(preview, extra?.accountEmail)
  );
  return {
    id: generateId(),
    accountId,
    calendarId: extra?.calendarId,
    eventUid: preview.uid?.trim() || generateId(),
    summary: preview.summary?.trim() || "Untitled Event",
    description: preview.description?.trim() || undefined,
    location: preview.location?.trim() || undefined,
    startAtMs: preview.start?.getTime() ?? now,
    endAtMs: preview.end?.getTime(),
    allDay: preview.allDay,
    startTimezone: preview.startTimezone,
    endTimezone: preview.endTimezone,
    recurrenceRule: preview.recurrenceRule,
    recurrenceDates: preview.recurrenceDates?.map((d) => d.getTime()),
    excludedDates: preview.excludedDates?.map((d) => d.getTime()),
    status: preview.status,
    organizer: preview.organizer,
    attendees: participation.attendees,
    myPartstat: participation.myPartstat,
    myPartstatUpdatedAtMs: participation.myPartstatUpdatedAtMs,
    myAttendeeEmail: participation.myAttendeeEmail,
    replyRequested: participation.replyRequested,
    sourceType,
    messageId: extra?.messageId,
    remoteEtag: extra?.remoteEtag,
    remoteHref: extra?.remoteHref,
    rawIcs: extra?.rawIcs,
    createdAtMs: now,
    updatedAtMs: now
  };
}
