/**
 * Write-side operations on a message's attachments. Currently just the
 * single-attachment removal used when the user strips an image/attachment
 * from a received mail: it drops the `attachments` row and, in the same
 * transaction, updates the message's IMAP UID to the copy that replaced it on
 * the server.
 *
 * No thread recompute runs here — attachments and imapUid feed no thread-level
 * signals.
 */
import { withDbWriteRetry } from "../../dbWriteRetry";
import { getAccountDb } from "../connection";

type RemoveAttachmentPatch = {
  imapUid?: number | null;
};

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
