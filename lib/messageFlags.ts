import type { Attachment } from "@/lib/data";

export const CALENDAR_INVITE_FLAG = "calendar-invite";
export const TODO_FLAG = "$Todo";
export const DONE_FLAG = "$Done";
export const AI_MODIFIED_FLAG = "$NoctuaAI";
export const NONJUNK_KEYWORD = "NONJUNK";
export const RECENT_IMAP_FLAG = "\\recent";
const LEGACY_CUSTOM_FLAGGED_KEYWORD = "pinned";
const LOCAL_ONLY_FLAGS = [CALENDAR_INVITE_FLAG, AI_MODIFIED_FLAG];

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
const normalizeKeyword = (value: string) => value.replace(/[\s-]/g, "").toLowerCase();

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

export function isCalendarAttachment(attachment: Pick<Attachment, "contentType" | "filename">) {
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

export function isRenderableInlineAttachment(attachment: Attachment, htmlBody?: string | null) {
  if (!attachment.inline) return false;
  if (!htmlBody?.trim()) return false;
  const contentType = normalize(attachment.contentType);
  if (!contentType.startsWith("image/")) return false;
  // The HTML fallback renderer intentionally skips SVG.
  return contentType !== "image/svg+xml";
}

export function shouldHideAttachmentFromList(attachment: Attachment, htmlBody?: string | null) {
  if (isCalendarAttachment(attachment)) return true;
  return isRenderableInlineAttachment(attachment, htmlBody);
}

export function isMeaningfulVisibleAttachment(attachment: Attachment, htmlBody?: string | null) {
  if (shouldHideAttachmentFromList(attachment, htmlBody)) return false;
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

export function isNonJunkKeyword(value: string) {
  return normalizeKeyword(value) === "nonjunk";
}

export function withoutRecentFlag(flags: string[] | null | undefined) {
  return (flags ?? []).filter((flag) => flag.toLowerCase() !== RECENT_IMAP_FLAG);
}

export function withoutNonJunkAndRecentFlags(flags: string[] | null | undefined) {
  return (flags ?? []).filter(
    (flag) => !isNonJunkKeyword(flag) && flag.toLowerCase() !== RECENT_IMAP_FLAG
  );
}

export function appendNonJunkKeyword(flags: string[] | null | undefined) {
  return [...withoutNonJunkAndRecentFlags(flags), NONJUNK_KEYWORD];
}

export function sameFlagOrderAndValues(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
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

export function hasAiModifiedFlag(flags: string[] | null | undefined) {
  return hasMessageFlag(flags, AI_MODIFIED_FLAG);
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

export function isLocalOnlyMessageFlag(flag: string) {
  const normalizedFlag = flag.trim().toLowerCase();
  return LOCAL_ONLY_FLAGS.some((value) => value.toLowerCase() === normalizedFlag);
}

export function appendMessageFlags(
  flags: string[] | null | undefined,
  additions: string[] | null | undefined
) {
  return normalizeImapFlags([...(flags ?? []), ...(additions ?? [])]);
}

export function preserveLocalOnlyMessageFlags(
  nextFlags: string[] | null | undefined,
  existingFlags: string[] | null | undefined
) {
  const localOnlyFlags = normalizeImapFlags(existingFlags).filter((flag) =>
    isLocalOnlyMessageFlag(flag)
  );
  return appendMessageFlags(nextFlags, localOnlyFlags);
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
