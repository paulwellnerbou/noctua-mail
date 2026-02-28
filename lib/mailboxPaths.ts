import type { Folder } from "@/lib/data";

export function folderMailboxPath(folder: Pick<Folder, "id" | "name">, accountId: string) {
  if (folder.id.startsWith(`${accountId}:`)) {
    return folder.id.slice(accountId.length + 1);
  }
  return folder.name;
}

export function mailboxPathFromFolderId(folderId: string, accountId: string) {
  if (folderId.startsWith(`${accountId}:`)) {
    return folderId.slice(accountId.length + 1);
  }
  return folderId;
}
