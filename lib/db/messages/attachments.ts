/**
 * Write-side message-row mutations backing attachment removal and its re-sync:
 * dropping a single `attachments` row (optionally repointing the message's IMAP
 * UID to the copy that replaced it on the server), and repointing the UID on its
 * own before a re-sync.
 *
 * No thread recompute runs here — attachments and imapUid feed no thread-level
 * signals.
 */
import { withDbWriteRetry } from "../../dbWriteRetry";
import { getAccountDb } from "../connection";

type RemoveAttachmentPatch = {
  imapUid?: number | null;
};

/**
 * Repoints a message row's IMAP UID. Used before re-syncing a server-rewritten
 * copy: the upsert treats a same-Message-ID fetch with a *different* UID as a
 * separate copy (collision variant), so the row must first be aligned to the
 * new UID for the re-sync to update it in place.
 */
export async function updateMessageImapUid(
  accountId: string,
  messageRowId: string,
  imapUid: number
) {
  return withDbWriteRetry("updateMessageImapUid", async () => {
    const db = await getAccountDb(accountId);
    db.prepare(`UPDATE messages SET imapUid = ? WHERE accountId = ? AND id = ?`).run(
      imapUid,
      accountId,
      messageRowId
    );
  });
}

export async function removeMessageAttachment(
  accountId: string,
  messageRowId: string,
  attachmentId: string,
  patch: RemoveAttachmentPatch = {}
) {
  return withDbWriteRetry("removeMessageAttachment", async () => {
    const db = await getAccountDb(accountId);
    db.transaction(() => {
      db.prepare(`DELETE FROM attachments WHERE messageId = ? AND id = ?`).run(
        messageRowId,
        attachmentId
      );
      if (patch.imapUid !== undefined) {
        db.prepare(`UPDATE messages SET imapUid = ? WHERE accountId = ? AND id = ?`).run(
          patch.imapUid,
          accountId,
          messageRowId
        );
      }
    })();
  });
}
