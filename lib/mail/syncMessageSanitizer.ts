import type { Attachment, Message } from "@/lib/data";
import { buildAccountAttachmentPath } from "@/lib/accountApiPaths";
import {
  appendUnreferencedInlineImages,
  replaceInlineImageSources,
  stripRedundantInlineImageFallbacks
} from "@/lib/html";
import { saveAttachmentData, saveMessageSource } from "@/lib/storage";

type AttachmentWithContent = Attachment & {
  content?: Buffer | Uint8Array | ArrayBuffer | null;
};

function buildAttachmentUrl(accountId: string, messageId: string, attachmentId: string) {
  return buildAccountAttachmentPath(accountId, messageId, attachmentId);
}

function parseDataUrlAttachment(dataUrl: string) {
  const prefix = "data:";
  if (!dataUrl.startsWith(prefix)) return null;
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) return null;
  const header = dataUrl.slice(prefix.length, commaIndex);
  if (!header.includes(";base64")) return null;
  const contentType = header.split(";")[0] || "application/octet-stream";
  const body = dataUrl.slice(commaIndex + 1);
  const buffer = Buffer.from(body, "base64");
  return { contentType, buffer };
}

export function getAttachmentContentBuffer(attachment: Attachment) {
  const attachmentWithContent = attachment as AttachmentWithContent;
  const content = attachmentWithContent.content;
  if (Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  }
  if (content instanceof ArrayBuffer) return Buffer.from(content);
  if (attachmentWithContent.dataUrl) {
    return parseDataUrlAttachment(attachmentWithContent.dataUrl)?.buffer ?? null;
  }
  return null;
}

export async function sanitizeSyncedMessage(message: Message, accountId: string): Promise<Message> {
  let sizeBytes = message.sizeBytes;
  if (message.source) {
    sizeBytes = await saveMessageSource(accountId, message.id, message.source);
  }
  let htmlBody = message.htmlBody;
  const dataUrlReplacements = new Map<string, string>();
  const attachments = await Promise.all(
    (message.attachments ?? []).map(async (attachment) => {
      const attachmentWithContent = attachment as AttachmentWithContent;
      const buffer = getAttachmentContentBuffer(attachmentWithContent);
      if (buffer) {
        await saveAttachmentData(accountId, message.id, attachment.id, buffer);
      }
      const url = buildAttachmentUrl(accountId, message.id, attachment.id);
      if (attachmentWithContent.dataUrl) {
        dataUrlReplacements.set(attachmentWithContent.dataUrl, url);
      }
      if (attachment.inline && htmlBody) {
        htmlBody = replaceInlineImageSources(htmlBody, [{ ...attachment, url }]);
      }
      const { dataUrl, content, ...rest } = attachmentWithContent;
      return { ...rest, url };
    })
  );
  if (htmlBody) {
    dataUrlReplacements.forEach((url, dataUrl) => {
      htmlBody = htmlBody?.replaceAll(dataUrl, url);
    });
    htmlBody = stripRedundantInlineImageFallbacks(htmlBody, attachments);
    htmlBody = appendUnreferencedInlineImages(htmlBody, attachments);
    htmlBody = htmlBody.replace(/data:(?!image\/)[^'")\s]+/gi, "about:blank");
  }
  const { source, ...rest } = message;
  return {
    ...rest,
    htmlBody,
    attachments,
    hasSource: Boolean(source ?? message.hasSource),
    sizeBytes
  };
}
