import { NextResponse } from "next/server";
import { getFolders, saveFoldersForAccount, updateMessagesFolderPrefix } from "@/lib/db";
import { listImapFolders, renameImapFolder } from "@/lib/mail/imap";
import { mailboxPathFromFolderId } from "@/lib/mailboxPaths";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    accountId: string;
    folderId: string;
    name: string;
  };
  if (!payload?.accountId || !payload?.folderId || !payload?.name) {
    return NextResponse.json({ ok: false, message: "Missing accountId, folderId, or name" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, payload.accountId);
  if (accountContext instanceof NextResponse) return accountContext;
  const { account, accountId, clientId } = accountContext;
  const folders = await getFolders(accountId);
  const folder = folders.find((item) => item.id === payload.folderId);
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
