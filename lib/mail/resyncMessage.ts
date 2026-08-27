// Re-fetch a single message from IMAP and re-ingest it into the local shard,
// replacing the stored row (attachments, htmlBody, imapUid, source) with a fresh
// parse. Used by the resync route and by attachment removal — after removal
// rewrites the message on the server its UID changes, and attachment ids are
// UID-derived, so the row must be re-parsed to pick up the new ids.
import type { Account, Message } from "@/lib/data";
import {
  getAttachmentIds,
  getMessageById,
  resolveThreadingForAccountMessages,
  updateMessageImapUid,
  upsertMessages
} from "@/lib/db";
import { syncImapMessage } from "@/lib/mail/imap";
import { mergeLocalOnlyMessageState } from "@/lib/messageLocalState";
import { sanitizeSyncedMessage } from "@/lib/mail/syncMessageSanitizer";
import { deleteAttachmentData } from "@/lib/storage";

type ExistingMessage = Message & { mailboxPath?: string | null };

/**
 * Fetches `uid` from `mailboxPath`, re-ingests it onto `existing`'s row, and
 * returns the freshly hydrated message. Returns null when the UID is no longer
 * on the server. Old attachment blobs are dropped first so the re-parsed
 * (possibly re-id'd) attachments don't leak stale cache files.
 */
export async function resyncImapMessageIntoDb(
  account: Account,
  existing: ExistingMessage,
  uid: number,
  clientId?: string
): Promise<Message | null> {
  const mailboxPath = existing.mailboxPath?.trim();
  if (!mailboxPath) return null;

  const message = await syncImapMessage(account, mailboxPath, uid, clientId);
  if (!message) return null;

  // Align the stored row to `uid` first. Otherwise a re-sync of a
  // server-rewritten copy (same Message-ID, new UID) is treated by the upsert
  // as a distinct second copy and written to a collision-variant row, leaving
  // this row — and its stale attachment ids — untouched. A no-op when re-syncing
  // the row's own UID (the manual re-sync path).
  await updateMessageImapUid(account.id, existing.id, uid);

  const attachmentIds = await getAttachmentIds(account.id, existing.id);
  await Promise.all(
    attachmentIds.map((attachmentId) => deleteAttachmentData(account.id, existing.id, attachmentId))
  );

  const [resolved] = await resolveThreadingForAccountMessages(account.id, [message]);
  const sanitized = await sanitizeSyncedMessage(
    { ...message, threadId: resolved.threadId, parentId: resolved.parentId },
    account.id
  );
  const merged = mergeLocalOnlyMessageState(sanitized, existing);
  await upsertMessages(account.id, message.folderId, [merged], false);

  return getMessageById(account.id, existing.id);
}
