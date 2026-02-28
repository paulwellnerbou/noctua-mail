import type { Folder, Message } from "@/lib/data";
import { folderMailboxPath, mailboxPathFromFolderId } from "@/lib/mailboxPaths";
export { folderMailboxPath, mailboxPathFromFolderId };
export { findTrashFolder } from "@/lib/specialFolders";

export function resolveMessageTrashState(
  message: Pick<Message, "folderId" | "mailboxPath">,
  trashFolder: Pick<Folder, "id" | "delimiter">,
  accountId: string
) {
  const trashMailbox = mailboxPathFromFolderId(trashFolder.id, accountId);
  const currentMailbox =
    message.mailboxPath || mailboxPathFromFolderId(message.folderId, accountId);
  const delimiter = trashFolder.delimiter ?? "/";
  const isInTrash =
    message.folderId === trashFolder.id ||
    currentMailbox === trashMailbox ||
    currentMailbox.startsWith(`${trashMailbox}${delimiter}`);
  return { currentMailbox, trashMailbox, isInTrash };
}
