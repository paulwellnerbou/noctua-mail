import type { Attachment } from "@/lib/data";

export const CALENDAR_INVITE_FLAG = "calendar-invite";
export const TODO_FLAG = "$Todo";
export const DONE_FLAG = "$Done";
const LEGACY_CUSTOM_FLAGGED_KEYWORD = "pinned";

export const CALENDAR_MIME_HINTS = [
  "text/calendar",
  "application/ics",
  "application/icalendar",
  "application/calendar",
  "application/x-ical",
  "application/x-vcalendar",
  "text/x-vcalendar",
  "application/vnd.ms-outlook"
];

export const CALENDAR_FILENAME_EXTENSIONS = [".ics", ".ical", ".ifb", ".vcs"];
export const CRYPTO_SIGNATURE_MIME_HINTS = [
  "application/pgp-signature",
  "application/pkcs7-signature",
  "application/x-pkcs7-signature"
];
export const CRYPTO_SIGNATURE_FILENAME_EXTENSIONS = [".asc", ".sig", ".p7s"];
export const MIN_VISIBLE_ATTACHMENT_SIZE_BYTES = 1024;
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

function includesHint(value: string, hints: readonly string[]) {
  if (!value) return false;
  return hints.some((hint) => value.includes(hint));
}

function endsWithExtension(value: string, extensions: readonly string[]) {
  if (!value) return false;
  return extensions.some((ext) => value.endsWith(ext));
}

function hasCalendarMime(value?: string | null) {
  const normalized = normalize(value);
  return includesHint(normalized, CALENDAR_MIME_HINTS);
}

export function isCalendarAttachment(attachment: Attachment) {
  return (
    hasCalendarMime(attachment.contentType) ||
    endsWithExtension(normalize(attachment.filename), CALENDAR_FILENAME_EXTENSIONS)
  );
}

export function isCryptographicSignatureAttachment(attachment: Attachment) {
  const contentType = normalize(attachment.contentType);
  if (includesHint(contentType, CRYPTO_SIGNATURE_MIME_HINTS)) return true;
  return endsWithExtension(
    normalize(attachment.filename),
    CRYPTO_SIGNATURE_FILENAME_EXTENSIONS
  );
}

export function isMeaningfulNonInlineAttachment(attachment: Attachment) {
  if (attachment.inline) return false;
  if (isCalendarAttachment(attachment)) return false;
  if (isCryptographicSignatureAttachment(attachment)) return false;
  const size = Number.isFinite(attachment.size) ? Number(attachment.size) : 0;
  return size >= MIN_VISIBLE_ATTACHMENT_SIZE_BYTES;
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

/**
 * Checks if the message has a Todo flag ($Todo)
 */
export function hasTodoFlag(flags: string[] | null | undefined) {
  return hasMessageFlag(flags, TODO_FLAG);
}

/**
 * Checks if the message has a Done flag ($Done)
 */
export function hasDoneFlag(flags: string[] | null | undefined) {
  return hasMessageFlag(flags, DONE_FLAG);
}

export function normalizeImapFlags(flags: string[] | null | undefined) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const rawFlag of flags ?? []) {
    const trimmed = rawFlag?.trim();
    if (!trimmed) continue;
    const mapped =
      trimmed.toLowerCase() === LEGACY_CUSTOM_FLAGGED_KEYWORD ? "\\Flagged" : trimmed;
    const key = mapped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(mapped);
  }
  return normalized;
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
  const deduped = normalizeImapFlags(flags);
  if (detectCalendarInvite(detectionInput) && !hasMessageFlag(deduped, CALENDAR_INVITE_FLAG)) {
    deduped.push(CALENDAR_INVITE_FLAG);
  }
  return deduped;
}
