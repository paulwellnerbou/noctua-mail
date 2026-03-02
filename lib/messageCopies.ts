import type { Message } from "./data";

type MailboxMessageIdentity = {
  folderId?: string | null;
  mailboxPath?: string | null;
  imapUid?: number | null;
};

export function isSameMailboxMessageCopy(
  existing: MailboxMessageIdentity,
  incoming: Pick<Message, "folderId" | "mailboxPath" | "imapUid">
) {
  if (existing.folderId && incoming.folderId && existing.folderId !== incoming.folderId) {
    return false;
  }
  const existingUid =
    typeof existing.imapUid === "number" && Number.isFinite(existing.imapUid)
      ? existing.imapUid
      : null;
  const incomingUid =
    typeof incoming.imapUid === "number" && Number.isFinite(incoming.imapUid)
      ? incoming.imapUid
      : null;
  if (existingUid !== null && incomingUid !== null) {
    return existingUid === incomingUid;
  }
  const existingMailbox = (existing.mailboxPath ?? "").trim().toLowerCase();
  const incomingMailbox = (incoming.mailboxPath ?? "").trim().toLowerCase();
  if (existingMailbox && incomingMailbox) {
    return existingMailbox === incomingMailbox;
  }
  return true;
}
