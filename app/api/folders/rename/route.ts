import { NextResponse } from "next/server";
import { getFolders, saveFoldersForAccount, updateMessagesFolderPrefix } from "@/lib/db";
import { listImapFolders, renameImapFolder } from "@/lib/mail/imap";
import { mailboxPathFromFolderId } from "@/lib/mailboxPaths";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";

export async function handleRenameFolderRequest(
  request: Request,
  options?: { accountId?: string | null; folderId?: string | null }
) {
  const payload = (await request.json()) as {
    accountId?: string;
    folderId?: string;
    name: string;
  };
  const accountId = options?.accountId ?? "";
  const folderId = options?.folderId ?? "";
  if (!accountId || !folderId || !payload?.name) {
    return NextResponse.json({ ok: false, message: "Missing accountId, folderId, or name" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId);
  if (accountContext instanceof NextResponse) return accountContext;
  const { account, clientId } = accountContext;
  const folders = await getFolders(accountId);
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) {
    return NextResponse.json({ ok: false, message: "Folder not found" }, { status: 404 });
  }
  const delimiter = folder.delimiter ?? "/";
  const mailboxPath = mailboxPathFromFolderId(folder.id, accountId);
  const parts = mailboxPath.split(delimiter);
  parts[parts.length - 1] = payload.name;
  const newPath = parts.join(delimiter);

  await renameImapFolder(account, mailboxPath, newPath, clientId);
  await updateMessagesFolderPrefix(accountId, mailboxPath, newPath);
  const updated = await listImapFolders(account, clientId);
  await saveFoldersForAccount(account.id, updated);
  return NextResponse.json({ ok: true, folders: updated });
}

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
