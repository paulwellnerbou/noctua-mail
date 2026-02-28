import { NextResponse } from "next/server";
import { getFolders, saveFoldersForAccount } from "@/lib/db";
import { createImapFolder, listImapFolders } from "@/lib/mail/imap";
import { mailboxPathFromFolderId } from "@/lib/mailboxPaths";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    accountId: string;
    name: string;
    parentId?: string | null;
  };
  if (!payload?.accountId || !payload?.name) {
    return NextResponse.json({ ok: false, message: "Missing accountId or name" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, payload.accountId);
  if (accountContext instanceof NextResponse) return accountContext;
  const { account, accountId, clientId } = accountContext;
  const folders = await getFolders(accountId);
  const parent = payload.parentId
    ? folders.find((folder) => folder.id === payload.parentId)
    : null;
  const delimiter = parent?.delimiter ?? "/";
  const parentPath = parent ? mailboxPathFromFolderId(parent.id, accountId) : "";
  const path = parentPath ? `${parentPath}${delimiter}${payload.name}` : payload.name;

  await createImapFolder(account, path, clientId);
  const updated = await listImapFolders(account, clientId);
  await saveFoldersForAccount(account.id, updated);
  return NextResponse.json({ ok: true, folders: updated });
}
