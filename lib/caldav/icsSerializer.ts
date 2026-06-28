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

function unfoldIcsLines(raw: string): string[] {
  const logical: string[] = [];
  for (const line of raw.split(/\r\n|\r|\n/)) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && logical.length > 0) {
      logical[logical.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      logical.push(line);
    }
  }
  return logical;
}

function icsPropName(line: string): string {
  const match = line.match(/^([^;:]+)/);
  return match ? match[1].trim().toUpperCase() : "";
}

function icsComponentName(line: string): string {
  return (line.split(":")[1] ?? "").trim().toUpperCase();
}

function icsUtcStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
}

function parseIcsUtcDate(value: string): number | undefined {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return undefined;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** Read the remote-modification time from an ICS blob (for conflict display). */
export function parseIcsLastModified(ics: string): number | undefined {
  const lines = unfoldIcsLines(ics);
  const pick = (name: string) => {
    const line = lines.find((l) => icsPropName(l) === name);
    if (!line) return undefined;
    return parseIcsUtcDate(line.slice(line.indexOf(":") + 1).trim());
  };
  return pick("LAST-MODIFIED") ?? pick("DTSTAMP");
}

/**
 * Locate the master VEVENT (the one without a RECURRENCE-ID) so per-occurrence
 * override components and VTIMEZONE blocks are left untouched when patching.
 */
function findMasterVeventRange(lines: string[]): { start: number; end: number } | null {
  let i = 0;
  while (i < lines.length) {
    if (icsPropName(lines[i]) === "BEGIN" && icsComponentName(lines[i]) === "VEVENT") {
      let j = i + 1;
      let hasRecurrenceId = false;
      while (j < lines.length) {
        const name = icsPropName(lines[j]);
        if (name === "RECURRENCE-ID") hasRecurrenceId = true;
        if (name === "END" && icsComponentName(lines[j]) === "VEVENT") break;
        j++;
      }
      if (j >= lines.length) return null;
      if (!hasRecurrenceId) return { start: i, end: j };
      i = j + 1;
    } else {
      i++;
    }
  }
  return null;
}

function buildIcsDtLine(name: "DTSTART" | "DTEND", ms: number, allDay: boolean, tz?: string): string {
  const formatted = formatIcsDate(ms, allDay, tz);
  if (allDay) return `${name};VALUE=DATE:${formatted}`;
  if (tz) return `${name};${formatted}`;
  return `${name}:${formatted}`;
}

/** Set PARTSTAT on the ATTENDEE line that belongs to `email`, leaving others as-is. */
function normalizeCalAddress(value: string): string {
  return value.trim().replace(/^mailto:/i, "").toLowerCase();
}

function patchAttendeePartstat(line: string, email: string, partstat: string): string {
  const colon = line.indexOf(":");
  if (colon === -1) return line;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  // Exact address match (after dropping the mailto: scheme) so an attendee
  // whose address merely contains the user's email isn't mis-targeted.
  if (normalizeCalAddress(value) !== normalizeCalAddress(email)) return line;
  const params = head.split(";");
  const idx = params.findIndex((p, k) => k > 0 && p.toUpperCase().startsWith("PARTSTAT="));
  if (idx >= 0) params[idx] = `PARTSTAT=${partstat}`;
  else params.push(`PARTSTAT=${partstat}`);
  return `${params.join(";")}:${value}`;
}

/**
 * Produce the ICS to push for a locally-edited CalDAV event by patching the
 * stored remote `rawIcs` in place — only the properties Noctua models are
 * replaced, so VALARM, X-props, other attendees, and unknown fields survive
 * the round-trip. Falls back to full serialization when no `rawIcs` exists
 * (locally-created events). SEQUENCE is bumped and DTSTAMP/LAST-MODIFIED
 * refreshed so the server and other clients see a newer revision.
 */
export function patchIcsForEvent(rawIcs: string | undefined, event: CalendarEvent): string {
  if (!rawIcs || !rawIcs.trim()) return calendarEventToIcs(event);
  const lines = unfoldIcsLines(rawIcs);
  const master = findMasterVeventRange(lines);
  if (!master) return calendarEventToIcs(event);

  let body = lines.slice(master.start + 1, master.end);

  // Mark only the VEVENT's *own* property lines (depth 0). Lines inside nested
  // subcomponents — VALARM and friends, which carry their own SUMMARY /
  // DESCRIPTION — must be left untouched, or patching the event would silently
  // strip alarm/reminder fields.
  const topLevelFlags = (allLines: string[]): boolean[] => {
    const flags: boolean[] = [];
    let depth = 0;
    for (const l of allLines) {
      const name = icsPropName(l);
      if (name === "BEGIN") {
        flags.push(false);
        depth++;
      } else if (name === "END") {
        depth--;
        flags.push(false);
      } else {
        flags.push(depth === 0);
      }
    }
    return flags;
  };

  const additions: string[] = [];
  const removeProp = (name: string) => {
    const tl = topLevelFlags(body);
    body = body.filter((l, i) => !(tl[i] && icsPropName(l) === name));
  };
  const setProp = (name: string, value: string | undefined, build: (v: string) => string) => {
    removeProp(name);
    if (value != null && value !== "") additions.push(build(value));
  };

  setProp("SUMMARY", event.summary, (v) => `SUMMARY:${escapeIcsText(v)}`);
  setProp("DESCRIPTION", event.description, (v) => `DESCRIPTION:${escapeIcsText(v)}`);
  setProp("LOCATION", event.location, (v) => `LOCATION:${escapeIcsText(v)}`);
  setProp("STATUS", event.status, (v) => `STATUS:${v.toUpperCase()}`);

  removeProp("DTSTART");
  additions.push(buildIcsDtLine("DTSTART", event.startAtMs, event.allDay, event.startTimezone));
  removeProp("DTEND");
  if (event.endAtMs != null) {
    additions.push(buildIcsDtLine("DTEND", event.endAtMs, event.allDay, event.endTimezone));
  }

  setProp("RRULE", event.recurrenceRule, (v) => `RRULE:${v}`);
  removeProp("RDATE");
  if (event.recurrenceDates?.length) {
    additions.push(`RDATE:${event.recurrenceDates.map((ms) => formatIcsDate(ms, event.allDay)).join(",")}`);
  }
  removeProp("EXDATE");
  if (event.excludedDates?.length) {
    additions.push(`EXDATE:${event.excludedDates.map((ms) => formatIcsDate(ms, event.allDay)).join(",")}`);
  }

  if (event.myAttendeeEmail && event.myPartstat) {
    const tl = topLevelFlags(body);
    body = body.map((l, i) =>
      tl[i] && icsPropName(l) === "ATTENDEE"
        ? patchAttendeePartstat(l, event.myAttendeeEmail!, event.myPartstat!)
        : l
    );
  }

  const tlSeq = topLevelFlags(body);
  const currentSeq = body
    .filter((l, i) => tlSeq[i] && icsPropName(l) === "SEQUENCE")
    .map((l) => parseInt(l.slice(l.indexOf(":") + 1).trim(), 10))
    .filter((n) => Number.isFinite(n));
  removeProp("SEQUENCE");
  additions.push(`SEQUENCE:${(currentSeq.length ? Math.max(...currentSeq) : 0) + 1}`);

  const stamp = icsUtcStamp(new Date());
  removeProp("DTSTAMP");
  additions.push(`DTSTAMP:${stamp}`);
  removeProp("LAST-MODIFIED");
  additions.push(`LAST-MODIFIED:${stamp}`);

  // Insert the refreshed properties at the front of the VEVENT body so they
  // stay top-level (ahead of any VALARM), never nested inside a subcomponent.
  const out = [
    ...lines.slice(0, master.start + 1),
    ...additions,
    ...body,
    ...lines.slice(master.end)
  ];
  return out.map(foldLine).join("\r\n");
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
