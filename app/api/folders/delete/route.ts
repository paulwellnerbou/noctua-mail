import { NextResponse } from "next/server";
import {
  deleteMessagesByFolderPrefix,
  getFolders,
  saveFoldersForAccount,
  updateMessagesFolderPrefix
} from "@/lib/db";
import {
  deleteImapFolder,
  listImapFolders,
  renameImapFolder,
  unsubscribeImapFolder
} from "@/lib/mail/imap";
import { notifyFolderDeleted } from "@/lib/mail/imapStreamRegistry";
import { findTrashFolder, mailboxPathFromFolderId } from "@/app/api/message/delete/trashUtils";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";

export async function handleDeleteFolderRequest(
  request: Request,
  options?: { accountId?: string | null; folderId?: string | null }
) {
  const startedAt = Date.now();
  const payload = (await request.json().catch(() => null)) as
    | { accountId?: string; folderId?: string }
    | null;
  const accountId = options?.accountId ?? "";
  const folderId = options?.folderId ?? "";
  if (!accountId || !folderId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or folderId" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId);
  if (accountContext instanceof NextResponse) return accountContext;
  const { account, clientId } = accountContext;
  const folders = await getFolders(accountId);
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) {
    return NextResponse.json({ ok: false, message: "Folder not found" }, { status: 404 });
  }
  const mailboxPath = mailboxPathFromFolderId(folder.id, accountId);
  const trashFolder = findTrashFolder(folders, accountId);
  if (!trashFolder) {
    return NextResponse.json(
      { ok: false, message: "Trash folder not found" },
      { status: 400 }
    );
  }
  const delimiter = trashFolder.delimiter ?? folder.delimiter ?? "/";
  const trashMailbox = mailboxPathFromFolderId(trashFolder.id, accountId);
  const isInTrash =
    folder.id === trashFolder.id ||
    mailboxPath === trashMailbox ||
    mailboxPath.startsWith(`${trashMailbox}${delimiter}`);

  if (isInTrash) {
    const t0 = Date.now();
    try {
      await unsubscribeImapFolder(account, mailboxPath, clientId);
    } catch (error) {
      console.info(`[imap] unsubscribe failed mailbox=${mailboxPath} ${String(error)}`);
    }
    await deleteImapFolder(account, mailboxPath, clientId);
    console.info(
      `[imap] delete folder mailbox=${mailboxPath} account=${account.id}${
        clientId ? ` client=${clientId}` : ""
      } ${Date.now() - t0}ms`
    );
    await notifyFolderDeleted(accountId, folder.id);
    const t1 = Date.now();
    await deleteMessagesByFolderPrefix(accountId, mailboxPath);
    console.info(
      `[db] delete messages folderPrefix=${mailboxPath} ${Date.now() - t1}ms`
    );
    const t2 = Date.now();
    const updated = await listImapFolders(account, clientId);
    console.info(
      `[imap] list folders account=${account.id}${clientId ? ` client=${clientId}` : ""} ${Date.now() - t2}ms`
    );
    const t3 = Date.now();
    await saveFoldersForAccount(account.id, updated);
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
  try {
    await unsubscribeImapFolder(account, newPath, clientId);
  } catch (error) {
    console.info(`[imap] unsubscribe failed mailbox=${newPath} ${String(error)}`);
  }
  await notifyFolderDeleted(accountId, folder.id);
  const t1 = Date.now();
  await updateMessagesFolderPrefix(accountId, mailboxPath, newPath);
  console.info(
    `[db] update messages folderPrefix=${mailboxPath} -> ${newPath} ${Date.now() - t1}ms`
  );
  const t2 = Date.now();
  const updated = await listImapFolders(account, clientId);
  console.info(
    `[imap] list folders account=${account.id}${clientId ? ` client=${clientId}` : ""} ${Date.now() - t2}ms`
  );
  const t3 = Date.now();
  await saveFoldersForAccount(account.id, updated);
  console.info(`[db] save folders ${Date.now() - t3}ms`);
  console.info(`[folders] move finished in ${Date.now() - startedAt}ms`);
  return NextResponse.json({ ok: true, action: "moved", folders: updated });
}

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
