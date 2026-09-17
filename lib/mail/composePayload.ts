import { buildCalendarIcsFilename, extractCalendarIcsMethod } from "@/lib/calendarIcs";
import { forwardMetaHtmlToText } from "@/lib/html";
import { markdownToEmailHtml } from "@/lib/markdownEmail";

export type ComposePayloadAttachment = {
  filename: string;
  contentType: string;
  inline?: boolean;
  cid?: string;
  dataUrl?: string;
};

export type ComposeResolvedAttachment = {
  filename: string;
  contentType: string;
  content: Buffer<ArrayBufferLike>;
  inline?: boolean;
  cid?: string;
};

const GENERIC_ATTACHMENT_FILENAME = /^attachment-\d+$/i;
const TEXT_CALENDAR_CONTENT_TYPE = /^\s*text\/calendar\s*(?:;|$)/i;
const FILENAME_EXTENSION = /\.[^.]+$/;
const CONTENT_TYPE_CHARSET = /;\s*charset=("?)([^";]+)\1/i;

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const buffer = Buffer.from(match[2], "base64");
  return { contentType: match[1], buffer };
}

function replaceInlineAttachmentDataUrls(
  html: string,
  attachments: ComposePayloadAttachment[] | undefined
) {
  let nextHtml = html;
  attachments?.forEach((attachment) => {
    if (!attachment.inline || !attachment.cid || !attachment.dataUrl) return;
    nextHtml = nextHtml.split(attachment.dataUrl).join(`cid:${attachment.cid}`);
  });
  return nextHtml;
}

export function parseComposeAttachments(
  attachments: ComposePayloadAttachment[] | undefined
): ComposeResolvedAttachment[] {
  return (
    attachments
      ?.map((attachment) => {
        if (!attachment.dataUrl) return null;
        const parsed = parseDataUrl(attachment.dataUrl);
        if (!parsed) return null;
        return {
          filename: attachment.filename,
          contentType: attachment.contentType || parsed.contentType,
          content: parsed.buffer as Buffer<ArrayBufferLike>,
          inline: Boolean(attachment.inline),
          cid: attachment.cid
        };
      })
      .filter(Boolean) as ComposeResolvedAttachment[]
  ) ?? [];
}

function decodeCalendarPart(content: Buffer) {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(content), utf8: true };
  } catch {
    return { text: content.toString("latin1"), utf8: false };
  }
}

/**
 * A declared charset describes the stored bytes and must survive the rewrite.
 * Without one, RFC 5545's UTF-8 default is only asserted when the bytes
 * really are UTF-8, so a mislabelled part is never made worse.
 */
function buildCalendarContentType(contentType: string, method: string, utf8: boolean) {
  const charset = contentType.match(CONTENT_TYPE_CHARSET)?.[2]?.trim() || (utf8 ? "UTF-8" : "");
  return charset
    ? `text/calendar; method=${method}; charset=${charset}`
    : `text/calendar; method=${method}`;
}

/**
 * Synced calendar parts carry only the bare MIME type and, when the sender
 * set no filename, a generic `attachment-N` name. Outlook only recognises an
 * invitation by the `method=` Content-Type parameter, so restore it from the
 * ICS body before the part is re-sent (typically on forward).
 *
 * Only `text/calendar` parts are touched. The `application/ics` twin that
 * Google attaches is a byte-identical download copy; leaving it alone keeps a
 * forward at one iTIP part, which is what Gmail and Apple Mail send too.
 */
export function normalizeCalendarAttachments(
  attachments: ComposeResolvedAttachment[]
): ComposeResolvedAttachment[] {
  return attachments.map((attachment) => {
    if (!TEXT_CALENDAR_CONTENT_TYPE.test(attachment.contentType)) return attachment;
    const { text: ics, utf8 } = decodeCalendarPart(attachment.content);
    if (!ics.trimStart().toUpperCase().startsWith("BEGIN:VCALENDAR")) return attachment;
    const method = extractCalendarIcsMethod(ics);
    if (!method) return attachment;
    const hasMethodParameter = /;\s*method=/i.test(attachment.contentType);
    const hasUsableFilename =
      FILENAME_EXTENSION.test(attachment.filename) &&
      !GENERIC_ATTACHMENT_FILENAME.test(attachment.filename);
    return {
      ...attachment,
      contentType: hasMethodParameter
        ? attachment.contentType
        : buildCalendarContentType(attachment.contentType, method, utf8),
      filename: hasUsableFilename ? attachment.filename : buildCalendarIcsFilename()
    };
  });
}

export async function resolveComposeHtml(options: {
  composeFormat?: string;
  markdown?: string;
  html?: string;
  attachments?: ComposePayloadAttachment[];
}) {
  const supplementalHtml = options.html?.trim() ?? "";
  let html: string | undefined;

  if (options.composeFormat === "markdown") {
    const markdownHtml = await markdownToEmailHtml(options.markdown ?? "");
    html = markdownHtml || supplementalHtml ? `${markdownHtml}${supplementalHtml}` : undefined;
  } else {
    html = supplementalHtml || undefined;
  }

  if (!html) return undefined;
  return replaceInlineAttachmentDataUrls(html, options.attachments);
}

/**
 * text/plain part of an outgoing mail. In markdown mode the client's text is
 * the markdown source, which drafts round-trip back into the editor, so the
 * forwarded header details are appended here at send time only: the quoted
 * original never reaches text/plain in that mode.
 */
export function resolveComposeText(options: {
  composeFormat?: string;
  text?: string;
  html?: string;
}): string {
  const text = options.text ?? "";
  if (options.composeFormat !== "markdown") return text;
  return [text, forwardMetaHtmlToText(options.html ?? "")].filter(Boolean).join("\n");
}
