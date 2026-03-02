import { getStoredMessagesByIds, relocateMovedMessage } from "@/lib/db";
import type { Account, Message } from "@/lib/data";
import { findMissingStoredMailboxCopies } from "@/lib/mail/imap";
import { isSameMailboxMessageCopy } from "@/lib/messageCopies";

export async function reconcileVerifiedCrossFolderMoves(
  account: Account,
  messages: Message[],
  clientId?: string
) {
  if (messages.length === 0) return;
  const existingRows = await getStoredMessagesByIds(
    account.id,
    messages.map((message) => message.id)
  );
  if (existingRows.length === 0) return;

  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const candidates = messages
    .map((message) => {
      const existing = existingById.get(message.id);
      if (!existing) return null;
      if (isSameMailboxMessageCopy(existing, message)) return null;
      if (
        !existing.mailboxPath ||
        typeof existing.imapUid !== "number" ||
        !Number.isFinite(existing.imapUid)
      ) {
        return null;
      }
      return {
        id: existing.id,
        messageId: existing.messageId,
        mailboxPath: existing.mailboxPath,
        imapUid: existing.imapUid,
        destinationFolderId: message.folderId,
        destinationMailboxPath: message.mailboxPath ?? message.folderId.replace(`${account.id}:`, ""),
        destinationUid: message.imapUid ?? null
      };
    })
    .filter(
      (
        candidate
      ): candidate is {
        id: string;
        messageId?: string | null;
        mailboxPath: string;
        imapUid: number;
        destinationFolderId: string;
        destinationMailboxPath: string;
        destinationUid: number | null;
      } => Boolean(candidate)
    );
  if (candidates.length === 0) return;

  const missingIds = await findMissingStoredMailboxCopies(
    account,
    candidates.map((candidate) => ({
      id: candidate.id,
      messageId: candidate.messageId,
      mailboxPath: candidate.mailboxPath,
      imapUid: candidate.imapUid
    })),
    clientId
  );
  if (missingIds.size === 0) return;

  for (const candidate of candidates) {
    if (!missingIds.has(candidate.id)) continue;
    await relocateMovedMessage({
      accountId: account.id,
      previousId: candidate.id,
      destinationFolderId: candidate.destinationFolderId,
      destinationMailboxPath: candidate.destinationMailboxPath,
      destinationUid: candidate.destinationUid
    });
  }
}
