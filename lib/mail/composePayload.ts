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
