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
import { resyncImapMessageIntoDb } from "@/lib/mail/resyncMessage";
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

// IO dependencies are injected (defaulting to the real implementations) so tests
// can exercise the destructive append-then-delete sequence and its error paths
// with plain fakes — no global mock.module(), which leaks across Bun's
// single-process test suite. The pure MIME surgery stays a direct call.
export type RemoveAttachmentDeps = {
  getMessageSourceBuffer: typeof getMessageSourceBuffer;
  fetchImapMessageSource: typeof fetchImapMessageSource;
  appendImapMessage: typeof appendImapMessage;
  deleteImapMessage: typeof deleteImapMessage;
  resyncMessage: typeof resyncImapMessageIntoDb;
  saveMessageSource: typeof saveMessageSource;
  deleteAttachmentData: typeof deleteAttachmentData;
  removeMessageAttachmentRow: typeof removeMessageAttachmentRow;
};

const defaultDeps: RemoveAttachmentDeps = {
  getMessageSourceBuffer,
  fetchImapMessageSource,
  appendImapMessage,
  deleteImapMessage,
  resyncMessage: resyncImapMessageIntoDb,
  saveMessageSource,
  deleteAttachmentData,
  removeMessageAttachmentRow
};

type RemovableMessage = Message & {
  mailboxPath?: string | null;
  imapUid?: number | null;
};

export type RemoveMessageAttachmentResult = {
  attachments: Attachment[];
  // The re-synced htmlBody carries the new UID-derived attachment URLs; the
  // client must apply it alongside `attachments` or the surviving inline
  // images (still referenced by their old URLs) would drop out at render.
  htmlBody: string | null;
  imapUid: number | null;
};

export async function removeMessageAttachmentEverywhere(
  account: Account,
  message: RemovableMessage,
  attachmentId: string,
  clientId?: string,
  deps: RemoveAttachmentDeps = defaultDeps
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

  let raw: Buffer | null = await deps.getMessageSourceBuffer(account.id, message.id);
  if (!raw) {
    raw = await deps.fetchImapMessageSource(account, mailboxPath, uid, clientId);
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

  const newUid = await deps.appendImapMessage(
    account,
    mailboxPath,
    strippedRaw,
    flags,
    clientId,
    internalDate
  );
  try {
    await deps.deleteImapMessage(account, mailboxPath, uid, clientId);
  } catch (deleteError) {
    // The append landed but the delete didn't (e.g. a transient IMAP/TLS
    // blip). Roll back the copy we just appended so the failure leaves the
    // original intact instead of a stripped duplicate. If we have no
    // APPENDUID we can't target the copy — the caller surfaces the error and
    // a duplicate may linger until the next full reconcile.
    if (typeof newUid === "number") {
      try {
        await deps.deleteImapMessage(account, mailboxPath, newUid, clientId);
      } catch {
        // Best effort; leave the original error as the surfaced failure.
      }
    }
    throw deleteError;
  }

  // Re-fetch the rewritten copy so the row picks up its new UID-derived
  // attachment ids (att-<account>-<uid>-<n>). Returning the pre-rewrite ids
  // would make a follow-up removal on the same message fail to match with
  // "Attachment not found". Requires APPENDUID (newUid); without it we patch
  // locally and let the next full sync reconcile the ids.
  if (typeof newUid === "number") {
    const resynced = await deps.resyncMessage(account, message, newUid, clientId);
    if (resynced) {
      return {
        attachments: resynced.attachments ?? [],
        htmlBody: resynced.htmlBody ?? null,
        imapUid: newUid
      };
    }
  }

  await deps.saveMessageSource(account.id, message.id, strippedRaw);
  await deps.deleteAttachmentData(account.id, message.id, attachmentId);
  await deps.removeMessageAttachmentRow(account.id, message.id, attachmentId, { imapUid: newUid });

  return {
    attachments: (message.attachments ?? []).filter((item) => item.id !== attachmentId),
    htmlBody: message.htmlBody ?? null,
    imapUid: newUid
  };
}
