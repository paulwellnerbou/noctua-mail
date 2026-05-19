/**
 * Per-message snapshot of a parsed VCALENDAR, persisted on
 * `message_calendar_events.snapshotJson` so we can later diff two messages
 * for the same eventUid and answer "what changed in this update?".
 *
 * The snapshot is intentionally a projection of the parsed VCALENDAR, not
 * a copy of the canonical `calendar_events` row, so it reflects what *this
 * message* asserted — independent of merge order or later updates.
 */
import { createHash } from "crypto";
import { parseIcsInvite, type CalendarEventPreview } from "./calendar";

export const CALENDAR_EVENT_SNAPSHOT_VERSION = 1;

export type ParsedRRule = {
  freq?: string;
  interval?: number;
  count?: number;
  untilMs?: number;
  byDay?: string[];
  byMonth?: number[];
  byMonthDay?: number[];
  bySetPos?: number[];
  wkst?: string;
};

export type CalendarSnapshotAttendee = {
  email?: string;
  name?: string;
  role?: string;
  partstat?: string;
  rsvp?: boolean;
};

export type CalendarSnapshotOrganizer = {
  email?: string;
  name?: string;
};

export type CalendarEventSnapshotFields = {
  status?: string;
  summary?: string;
  location?: string;
  descriptionHash?: string;
  descriptionPreview?: string;
  startAtMs?: number;
  endAtMs?: number;
  allDay?: boolean;
  startTimezone?: string;
  endTimezone?: string;
  organizer?: CalendarSnapshotOrganizer;
  attendees?: CalendarSnapshotAttendee[];
  rrule?: ParsedRRule | null;
  rdates?: number[];
  exdates?: number[];
};

export type CalendarEventSnapshotOverride = {
  recurrenceIdMs: number;
  cancelled: boolean;
  fields?: Omit<CalendarEventSnapshotFields, "rrule" | "rdates" | "exdates">;
};

export type CalendarEventSnapshot = {
  v: number;
  uid: string;
  method?: string;
  sequence: number;
  cancelledWhole: boolean;
  base: CalendarEventSnapshotFields | null;
  overrides: CalendarEventSnapshotOverride[];
};

const TEAMS_NOISE_PATTERNS = [
  /https?:\/\/teams\.microsoft\.com\/[^\s>]+/g,
  /https?:\/\/dialin\.teams\.microsoft\.com\/[^\s>]+/g,
  /https?:\/\/aka\.ms\/[^\s>]+/g,
  // Long underscore separators Outlook uses to wrap the meeting block
  /_{10,}/g,
  // Teams dial-in lines (DE/EN forms)
  /Besprechungs-ID:\s*[\d\s]+/gi,
  /Meeting ID:\s*[\d\s]+/gi,
  /Telefonkonferenz-ID:\s*[\d\s]+#?/gi,
  /Conference ID:\s*[\d\s]+#?/gi,
  /Passcode:\s*\S+/gi,
  // tel: URIs are sometimes inline
  /<?tel:\+?[\d,#\s]+>?/gi
];

/**
 * Strip the volatile Microsoft Teams / Zoom / dial-in boilerplate from a
 * description so two invites that only differ in their generated dial-in
 * blob hash identically.
 */
function normalizeDescription(description?: string): {
  hash?: string;
  preview?: string;
} {
  if (!description) return {};
  let normalized = description;
  TEAMS_NOISE_PATTERNS.forEach((pattern) => {
    normalized = normalized.replace(pattern, "");
  });
  normalized = normalized.replace(/\s+/g, " ").trim();
  if (!normalized) return {};
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  const preview = normalized.length > 240 ? `${normalized.slice(0, 240)}…` : normalized;
  return { hash, preview };
}

function normalizeMs(value?: Date): number | undefined {
  if (!value) return undefined;
  const ms = value.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.round(ms);
}

function normalizeDateList(dates?: Date[]): number[] | undefined {
  if (!Array.isArray(dates) || dates.length === 0) return undefined;
  const out = Array.from(
    new Set(
      dates
        .map((d) => d?.getTime())
        .filter((ms): ms is number => typeof ms === "number" && Number.isFinite(ms) && ms > 0)
        .map((ms) => Math.round(ms))
    )
  ).sort((a, b) => a - b);
  return out.length > 0 ? out : undefined;
}

function parseEmailAddress(raw?: string): { email?: string; name?: string } | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const angle = trimmed.match(/^(.*?)<([^>]+)>$/);
  if (angle) {
    const name = angle[1].trim().replace(/^"|"$/g, "").trim();
    const email = angle[2].trim().toLowerCase();
    return { email: email || undefined, name: name || undefined };
  }
  if (trimmed.toLowerCase().startsWith("mailto:")) {
    return { email: trimmed.slice("mailto:".length).trim().toLowerCase() || undefined };
  }
  if (trimmed.includes("@")) {
    return { email: trimmed.toLowerCase() };
  }
  return { name: trimmed };
}

function normalizeOrganizer(
  event: CalendarEventPreview
): CalendarSnapshotOrganizer | undefined {
  const parsed = parseEmailAddress(event.organizer);
  const email = event.organizerEmail?.trim().toLowerCase() || parsed?.email;
  const name = parsed?.name;
  if (!email && !name) return undefined;
  const out: CalendarSnapshotOrganizer = {};
  if (email) out.email = email;
  if (name) out.name = name;
  return out;
}

function normalizeAttendees(
  event: CalendarEventPreview
): CalendarSnapshotAttendee[] | undefined {
  if (!event.attendeeDetails || event.attendeeDetails.length === 0) return undefined;
  const out = event.attendeeDetails
    .map((att) => {
      const email = att.email?.trim().toLowerCase();
      const name = att.name?.trim() || undefined;
      const role = att.role?.trim().toUpperCase() || undefined;
      const partstat = att.partstat?.trim().toUpperCase() || undefined;
      const rsvp = typeof att.rsvp === "boolean" ? att.rsvp : undefined;
      if (!email && !name) return null;
      const entry: CalendarSnapshotAttendee = {};
      if (email) entry.email = email;
      if (name) entry.name = name;
      if (role) entry.role = role;
      if (partstat) entry.partstat = partstat;
      if (typeof rsvp === "boolean") entry.rsvp = rsvp;
      return entry;
    })
    .filter((x): x is CalendarSnapshotAttendee => Boolean(x));
  // Sort by email so set-membership comparisons are stable regardless of
  // the order the ATTENDEE properties appear in the ICS.
  out.sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));
  return out.length > 0 ? out : undefined;
}

const RRULE_LIST_KEYS = new Set(["BYDAY", "BYMONTH", "BYMONTHDAY", "BYSETPOS"]);

function parseUntilToken(raw: string): number | undefined {
  const trimmed = raw.trim();
  // Forms: 20260506T133000Z (UTC), 20260506T133000 (floating), 20260506 (date)
  const utc = trimmed.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?Z$/);
  if (utc) {
    const [, y, m, d, h, mi, s] = utc;
    return Date.UTC(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(h ?? "0"),
      Number(mi ?? "0"),
      Number(s ?? "0")
    );
  }
  const floating = trimmed.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?$/);
  if (floating) {
    const [, y, m, d, h, mi, s] = floating;
    return Date.UTC(
      Number(y),
      Number(m) - 1,
      Number(d),
      Number(h ?? "0"),
      Number(mi ?? "0"),
      Number(s ?? "0")
    );
  }
  return undefined;
}

export function parseRecurrenceRule(rule?: string): ParsedRRule | undefined {
  if (!rule) return undefined;
  let body = rule.trim();
  if (body.toUpperCase().startsWith("RRULE:")) body = body.slice(6).trim();
  if (!body) return undefined;
  const out: ParsedRRule = {};
  body.split(";").forEach((pair) => {
    const [rawKey, rawValue] = pair.split("=");
    if (!rawKey || rawValue === undefined) return;
    const key = rawKey.trim().toUpperCase();
    const value = rawValue.trim();
    if (!value) return;
    if (key === "FREQ") out.freq = value.toUpperCase();
    else if (key === "INTERVAL") {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) out.interval = n;
    } else if (key === "COUNT") {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) out.count = n;
    } else if (key === "UNTIL") {
      const ms = parseUntilToken(value);
      if (typeof ms === "number") out.untilMs = ms;
    } else if (key === "WKST") {
      out.wkst = value.toUpperCase();
    } else if (RRULE_LIST_KEYS.has(key)) {
      const parts = value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length === 0) return;
      if (key === "BYDAY") out.byDay = parts.map((p) => p.toUpperCase());
      else if (key === "BYMONTH")
        out.byMonth = parts
          .map((p) => Number.parseInt(p, 10))
          .filter((n) => Number.isFinite(n));
      else if (key === "BYMONTHDAY")
        out.byMonthDay = parts
          .map((p) => Number.parseInt(p, 10))
          .filter((n) => Number.isFinite(n));
      else if (key === "BYSETPOS")
        out.bySetPos = parts
          .map((p) => Number.parseInt(p, 10))
          .filter((n) => Number.isFinite(n));
    }
  });
  return Object.keys(out).length > 0 ? out : undefined;
}

function projectBaseFields(event: CalendarEventPreview): CalendarEventSnapshotFields {
  const { hash: descriptionHash, preview: descriptionPreview } = normalizeDescription(
    event.description
  );
  const out: CalendarEventSnapshotFields = {};
  if (event.status) out.status = event.status.trim().toUpperCase();
  if (event.summary) out.summary = event.summary.trim();
  if (event.location) out.location = event.location.trim();
  if (descriptionHash) out.descriptionHash = descriptionHash;
  if (descriptionPreview) out.descriptionPreview = descriptionPreview;
  const startAtMs = normalizeMs(event.start);
  if (typeof startAtMs === "number") out.startAtMs = startAtMs;
  const endAtMs = normalizeMs(event.end);
  if (typeof endAtMs === "number") out.endAtMs = endAtMs;
  if (event.allDay) out.allDay = true;
  if (event.startTimezone) out.startTimezone = event.startTimezone;
  if (event.endTimezone) out.endTimezone = event.endTimezone;
  const organizer = normalizeOrganizer(event);
  if (organizer) out.organizer = organizer;
  const attendees = normalizeAttendees(event);
  if (attendees) out.attendees = attendees;
  const rrule = parseRecurrenceRule(event.recurrenceRule);
  if (rrule) out.rrule = rrule;
  const rdates = normalizeDateList(event.recurrenceDates);
  if (rdates) out.rdates = rdates;
  const exdates = normalizeDateList(event.excludedDates);
  if (exdates) out.exdates = exdates;
  return out;
}

function projectOverrideFields(
  event: CalendarEventPreview
): CalendarEventSnapshotOverride["fields"] {
  const fields = projectBaseFields(event);
  // Per-occurrence override snapshots don't carry series-level recurrence
  // descriptors; the override identifies an instance, not the rule.
  delete (fields as CalendarEventSnapshotFields).rrule;
  delete (fields as CalendarEventSnapshotFields).rdates;
  delete (fields as CalendarEventSnapshotFields).exdates;
  return Object.keys(fields).length > 0 ? fields : undefined;
}

/**
 * Build a snapshot for one eventUid present in the given ICS source. If the
 * ICS contains multiple VEVENTs sharing this UID (a base + recurrence-id
 * overrides), they all contribute. Returns null if no VEVENT in the ICS has
 * the requested UID.
 */
export function buildCalendarEventSnapshot(
  icsSource: string,
  eventUid: string
): CalendarEventSnapshot | null {
  const trimmedUid = eventUid?.trim();
  if (!trimmedUid) return null;
  // UID comparison is case-insensitive: Outlook serializes Exchange
  // event UIDs in upper case but our DB stores them lower-cased via
  // normalizeCalendarEventUid.
  const matchKey = trimmedUid.toLowerCase();
  const parsed = parseIcsInvite(icsSource);
  const method = parsed.method?.trim().toUpperCase() || undefined;
  const matching = parsed.events.filter(
    (event) => (event.uid ?? "").trim().toLowerCase() === matchKey
  );
  if (matching.length === 0) return null;

  let base: CalendarEventSnapshotFields | null = null;
  const overrides: CalendarEventSnapshotOverride[] = [];
  let sequence = 0;
  let cancelledWhole = false;

  matching.forEach((event) => {
    const eventSequence =
      typeof event.sequence === "number" && Number.isFinite(event.sequence)
        ? event.sequence
        : 0;
    if (eventSequence > sequence) sequence = eventSequence;
    const isCancelled =
      method === "CANCEL" ||
      (event.status?.trim().toUpperCase() === "CANCELLED");
    const recurrenceIdMs = normalizeMs(event.recurrenceId);
    if (typeof recurrenceIdMs === "number") {
      overrides.push({
        recurrenceIdMs,
        cancelled: isCancelled,
        fields: isCancelled ? undefined : projectOverrideFields(event)
      });
      return;
    }
    if (isCancelled) {
      cancelledWhole = true;
      // Still record any fields the cancellation message carries (Outlook
      // usually echoes SUMMARY/DTSTART) so we can render a meaningful
      // "Cancelled: <summary>" line in the diff.
      base = projectBaseFields(event);
      return;
    }
    base = projectBaseFields(event);
  });

  overrides.sort((a, b) => a.recurrenceIdMs - b.recurrenceIdMs);

  return {
    v: CALENDAR_EVENT_SNAPSHOT_VERSION,
    uid: trimmedUid,
    method,
    sequence,
    cancelledWhole,
    base,
    overrides
  };
}

export function serializeCalendarEventSnapshot(snapshot: CalendarEventSnapshot): string {
  return JSON.stringify(snapshot);
}

export function parseCalendarEventSnapshot(
  raw?: string | null
): CalendarEventSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CalendarEventSnapshot;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.uid !== "string" || !parsed.uid) return null;
    if (typeof parsed.v !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}
