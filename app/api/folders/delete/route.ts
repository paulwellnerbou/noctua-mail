import { NextResponse } from "next/server";
import {
  deleteMessagesByFolderPrefix,
  getAccounts,
  getFolders,
  saveFolders,
  updateMessagesFolderPrefix
} from "@/lib/db";
import { deleteImapFolder, listImapFolders, renameImapFolder } from "@/lib/mail/imap";
import { notifyFolderDeleted } from "@/lib/mail/imapStreamRegistry";
import type { Folder } from "@/lib/data";
import { requireSessionOr401 } from "@/lib/auth";

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
  const auth = await requireSessionOr401(request);
  if (auth instanceof NextResponse) return auth;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const startedAt = Date.now();
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
    const t0 = Date.now();
    await deleteImapFolder(account, mailboxPath, clientId);
    console.info(
      `[imap] delete folder mailbox=${mailboxPath} account=${account.id}${
        clientId ? ` client=${clientId}` : ""
      } ${Date.now() - t0}ms`
    );
    await notifyFolderDeleted(payload.accountId, folder.id);
    const t1 = Date.now();
    await deleteMessagesByFolderPrefix(payload.accountId, mailboxPath);
    console.info(
      `[db] delete messages folderPrefix=${mailboxPath} ${Date.now() - t1}ms`
    );
    const t2 = Date.now();
    const updated = await listImapFolders(account, clientId);
    console.info(
      `[imap] list folders account=${account.id}${clientId ? ` client=${clientId}` : ""} ${Date.now() - t2}ms`
    );
    const t3 = Date.now();
    const existing = await getFolders();
    const next = [...existing.filter((item) => item.accountId !== account.id), ...updated];
    await saveFolders(next);
    console.info(`[db] save folders ${Date.now() - t3}ms`);
    console.info(`[folders] delete finished in ${Date.now() - startedAt}ms`);
    return NextResponse.json({ ok: true, action: "deleted", folders: updated });
  }

  const parts = mailboxPath.split(delimiter);
  const leafName = parts[parts.length - 1] || folder.name;
  const newPath = `${trashMailbox}${delimiter}${leafName}`;
  const t0 = Date.now();
  await renameImapFolder(account, mailboxPath, newPath, clientId);
  console.info(
    `[imap] move folder mailbox=${mailboxPath} newMailbox=${newPath} account=${account.id}${
      clientId ? ` client=${clientId}` : ""
    } ${Date.now() - t0}ms`
  );
  await notifyFolderDeleted(payload.accountId, folder.id);
  const t1 = Date.now();
  await updateMessagesFolderPrefix(payload.accountId, mailboxPath, newPath);
  console.info(
    `[db] update messages folderPrefix=${mailboxPath} -> ${newPath} ${Date.now() - t1}ms`
  );
  const t2 = Date.now();
  const updated = await listImapFolders(account, clientId);
  console.info(
    `[imap] list folders account=${account.id}${clientId ? ` client=${clientId}` : ""} ${Date.now() - t2}ms`
  );
  const t3 = Date.now();
  const existing = await getFolders();
  const next = [...existing.filter((item) => item.accountId !== account.id), ...updated];
  await saveFolders(next);
  console.info(`[db] save folders ${Date.now() - t3}ms`);
  console.info(`[folders] move finished in ${Date.now() - startedAt}ms`);
  return NextResponse.json({ ok: true, action: "moved", folders: updated });
}
