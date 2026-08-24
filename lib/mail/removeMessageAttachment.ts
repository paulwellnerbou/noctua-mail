// Removes one attachment/image from a received mail, everywhere:
//   1. Rewrite the message on the IMAP server — append a copy with the part
//      spliced out (Message-ID, flags and internal date preserved), then delete
//      and expunge the original. IMAP messages are immutable, so append-then-
//      delete is the only way to "edit" one.
//   2. Purge the local raw source and cached blob, and drop the attachments row.
//
// The append runs before the delete so a failure leaves the original intact.
// Because the local row id derives from the (preserved) Message-ID, the appended
// copy reconciles back onto the same row on the next sync. A removed inline image
// leaves a dangling `cid:` <img> in the HTML part (which we don't rewrite); the
// viewer drops it at render time via stripUnresolvedCidImages, which survives the
// re-parse a rewrite of the stored htmlBody would not.
import type { Account, Attachment, Message } from "@/lib/data";
import { removeMessageAttachment as removeMessageAttachmentRow } from "@/lib/db";
import {
  appendImapMessage,
  deleteImapMessage,
  fetchImapMessageSource
} from "@/lib/mail/imap";
import { removeAttachmentPartFromRawMessage } from "@/lib/mail/mime/removeAttachmentPart";
import {
  RECENT_IMAP_FLAG,
  isLocalOnlyMessageFlag,
  normalizeImapFlags
} from "@/lib/messageFlags";
import {
  deleteAttachmentData,
  getMessageSourceBuffer,
  saveMessageSource
} from "@/lib/storage";

type RemovableMessage = Message & {
  mailboxPath?: string | null;
  imapUid?: number | null;
};

export type RemoveMessageAttachmentResult = {
  attachments: Attachment[];
  imapUid: number | null;
};

export async function removeMessageAttachmentEverywhere(
  account: Account,
  message: RemovableMessage,
  attachmentId: string,
  clientId?: string
): Promise<RemoveMessageAttachmentResult> {
  const attachment = (message.attachments ?? []).find((item) => item.id === attachmentId);
  if (!attachment) {
    throw new Error("Attachment not found");
  }

  const mailboxPath = message.mailboxPath?.trim();
  const uid = typeof message.imapUid === "number" ? message.imapUid : null;
  if (!mailboxPath || uid === null || !Number.isFinite(uid) || uid <= 0) {
    throw new Error("Message is missing IMAP metadata");
  }

  let raw: Buffer | null = await getMessageSourceBuffer(account.id, message.id);
  if (!raw) {
    raw = await fetchImapMessageSource(account, mailboxPath, uid, clientId);
  }
  if (!raw) {
    throw new Error("Message source is unavailable");
  }

  const { raw: strippedRaw, removed } = removeAttachmentPartFromRawMessage(raw, {
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    cid: attachment.cid
  });
  if (!removed) {
    throw new Error("Could not locate the attachment in the message source");
  }

  const flags = normalizeImapFlags(message.flags).filter(
    (flag) => !isLocalOnlyMessageFlag(flag) && flag.toLowerCase() !== RECENT_IMAP_FLAG
  );
  const internalDate =
    typeof message.dateValue === "number" && Number.isFinite(message.dateValue)
      ? new Date(message.dateValue)
      : new Date();

  const newUid = await appendImapMessage(
    account,
    mailboxPath,
    strippedRaw,
    flags,
    clientId,
    internalDate
  );
  await deleteImapMessage(account, mailboxPath, uid, clientId);

  await saveMessageSource(account.id, message.id, strippedRaw);
  await deleteAttachmentData(account.id, message.id, attachmentId);

  await removeMessageAttachmentRow(account.id, message.id, attachmentId, { imapUid: newUid });

  return {
    attachments: (message.attachments ?? []).filter((item) => item.id !== attachmentId),
    imapUid: newUid
  };
}
