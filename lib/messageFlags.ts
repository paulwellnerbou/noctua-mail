import type { Attachment } from "@/lib/data";

export const CALENDAR_INVITE_FLAG = "calendar-invite";

const CALENDAR_MIME_HINTS = [
  "text/calendar",
  "application/ics",
  "application/icalendar",
  "application/calendar",
  "application/x-ical",
  "application/x-vcalendar",
  "text/x-vcalendar",
  "application/vnd.ms-outlook"
];

const CALENDAR_FILENAME_EXTENSIONS = [".ics", ".ical", ".ifb", ".vcs"];
const CALENDAR_HEADER_HINTS = [
  "urn:content-classes:calendarmessage",
  "text/calendar",
  "vcalendar",
  "method=request",
  "method=cancel",
  "method=reply"
];

type CalendarInviteDetectionInput = {
  attachments?: Attachment[] | null;
  textBody?: string | null;
  htmlBody?: string | null;
  headerValues?: Array<string | null | undefined>;
};

const normalize = (value?: string | null) => (value ?? "").trim().toLowerCase();

function hasCalendarMime(value?: string | null) {
  const normalized = normalize(value);
  if (!normalized) return false;
  return CALENDAR_MIME_HINTS.some((hint) => normalized.includes(hint));
}

function isCalendarAttachment(attachment: Attachment) {
  if (hasCalendarMime(attachment.contentType)) return true;
  const filename = normalize(attachment.filename);
  return CALENDAR_FILENAME_EXTENSIONS.some((ext) => filename.endsWith(ext));
}

function bodyLooksLikeCalendarInvite(textBody?: string | null, htmlBody?: string | null) {
  const combined = `${textBody ?? ""}\n${htmlBody ?? ""}`.toLowerCase();
  if (!combined.trim()) return false;
  if (combined.includes("begin:vcalendar")) return true;
  return (
    combined.includes("begin:vevent") &&
    /(method:(request|cancel|reply)|content-type:\s*text\/calendar)/i.test(combined)
  );
}

export function hasMessageFlag(flags: string[] | null | undefined, flag: string) {
  const target = flag.toLowerCase();
  return (flags ?? []).some((item) => item.toLowerCase() === target);
}

export function detectCalendarInvite(input: CalendarInviteDetectionInput) {
  if ((input.attachments ?? []).some(isCalendarAttachment)) return true;
  const headerBlob = (input.headerValues ?? []).map(normalize).filter(Boolean).join(" ");
  if (headerBlob) {
    if (CALENDAR_HEADER_HINTS.some((hint) => headerBlob.includes(hint))) {
      return true;
    }
  }
  return bodyLooksLikeCalendarInvite(input.textBody, input.htmlBody);
}

export function withCalendarInviteFlag(
  flags: string[] | null | undefined,
  detectionInput: CalendarInviteDetectionInput
) {
  const seen = new Set<string>();
  const deduped = (flags ?? []).filter((flag) => {
    const normalized = flag.toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
  if (detectCalendarInvite(detectionInput) && !hasMessageFlag(deduped, CALENDAR_INVITE_FLAG)) {
    deduped.push(CALENDAR_INVITE_FLAG);
  }
  return deduped;
}
