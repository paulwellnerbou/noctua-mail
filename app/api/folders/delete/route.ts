import { NextResponse } from "next/server";
import {
  deleteMessagesByFolderPrefix,
  getAccounts,
  getFolders,
  saveFolders,
  updateMessagesFolderPrefix
} from "@/lib/db";
import { deleteImapFolder, listImapFolders, renameImapFolder } from "@/lib/mail/imap";
import type { Folder } from "@/lib/data";

const TRASH_NAMES = [
  "trash",
  "deleted",
  "deleted items",
  "deleted messages",
  "bin",
  "wastebasket",
  "papierkorb",
  "corbeille",
  "corbeille papier"
];

function mailboxPathFromFolderId(folderId: string, accountId: string) {
  if (folderId.startsWith(`${accountId}:`)) {
    return folderId.slice(accountId.length + 1);
  }
  return folderId;
}

function findTrashFolder(folders: Folder[], accountId: string) {
  const candidates = folders.filter((folder) => folder.accountId === accountId);
  const bySpecial = candidates.find(
    (folder) => (folder.specialUse ?? "").toLowerCase() === "\\trash"
  );
  if (bySpecial) return bySpecial;
  const byName = candidates.find((folder) =>
    TRASH_NAMES.includes(folder.name.trim().toLowerCase())
  );
  if (byName) return byName;
  const byId = candidates.find((folder) =>
    TRASH_NAMES.some((name) => folder.id.toLowerCase().includes(name))
  );
  if (byId) return byId;
  const byPartial = candidates.find((folder) =>
    folder.name.toLowerCase().includes("trash") ||
    folder.name.toLowerCase().includes("deleted")
  );
  return byPartial ?? null;
}

export async function POST(request: Request) {
  const payload = (await request.json()) as { accountId: string; folderId: string };
  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === payload.accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  const folders = await getFolders(payload.accountId);
  const folder = folders.find((item) => item.id === payload.folderId);
  if (!folder) {
    return NextResponse.json({ ok: false, message: "Folder not found" }, { status: 404 });
  }
  const mailboxPath = mailboxPathFromFolderId(folder.id, payload.accountId);
  const trashFolder = findTrashFolder(folders, payload.accountId);
  if (!trashFolder) {
    return NextResponse.json(
      { ok: false, message: "Trash folder not found" },
      { status: 400 }
    );
  }
  const delimiter = trashFolder.delimiter ?? folder.delimiter ?? "/";
  const trashMailbox = mailboxPathFromFolderId(trashFolder.id, payload.accountId);
  const isInTrash =
    folder.id === trashFolder.id ||
    mailboxPath === trashMailbox ||
    mailboxPath.startsWith(`${trashMailbox}${delimiter}`);

  if (isInTrash) {
    await deleteImapFolder(account, mailboxPath);
    await deleteMessagesByFolderPrefix(payload.accountId, mailboxPath);
    const updated = await listImapFolders(account);
    const existing = await getFolders();
    const next = [...existing.filter((item) => item.accountId !== account.id), ...updated];
    await saveFolders(next);
    return NextResponse.json({ ok: true, action: "deleted", folders: updated });
  }

  const parts = mailboxPath.split(delimiter);
  const leafName = parts[parts.length - 1] || folder.name;
  const newPath = `${trashMailbox}${delimiter}${leafName}`;
  await renameImapFolder(account, mailboxPath, newPath);
  await updateMessagesFolderPrefix(payload.accountId, mailboxPath, newPath);
  const updated = await listImapFolders(account);
  const existing = await getFolders();
  const next = [...existing.filter((item) => item.accountId !== account.id), ...updated];
  await saveFolders(next);
  return NextResponse.json({ ok: true, action: "moved", folders: updated });
}
