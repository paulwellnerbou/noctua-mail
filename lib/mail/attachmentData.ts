import type { Attachment } from "@/lib/data";
import { extractAttachmentBufferFromSource } from "@/lib/mail/attachmentFromSource";
import { getAttachmentData, getMessageSource, saveAttachmentData } from "@/lib/storage";

/**
 * Bytes of one attachment. Sync only stores the parts it decoded at the
 * time, so an attachment without a stored copy is cut out of the cached raw
 * source and stored for the next request. Null when neither the stored data
 * nor a usable source exists.
 */
export async function loadAttachmentData(
  accountId: string,
  messageId: string,
  attachment: Pick<Attachment, "id" | "filename" | "contentType" | "cid">
): Promise<Buffer<ArrayBuffer> | null> {
  const stored = await getAttachmentData(accountId, messageId, attachment.id);
  if (stored) return stored;

  const source = await getMessageSource(accountId, messageId);
  if (!source) return null;

  // A source mailparser cannot read yields no data, same as a missing one.
  try {
    const extracted = await extractAttachmentBufferFromSource(source, attachment);
    if (!extracted) return null;
    const data = Buffer.from(extracted);
    await saveAttachmentData(accountId, messageId, attachment.id, data);
    return data;
  } catch {
    return null;
  }
}
