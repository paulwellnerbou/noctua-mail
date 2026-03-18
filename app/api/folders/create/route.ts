import { NextResponse } from "next/server";
import { getFolders, saveFoldersForAccount } from "@/lib/db";
import { createImapFolder, listImapFolders } from "@/lib/mail/imap";
import { mailboxPathFromFolderId } from "@/lib/mailboxPaths";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";

export async function handleCreateFolderRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const payload = (await request.json()) as {
    accountId?: string;
    name: string;
    parentId?: string | null;
  };
  const accountId = options?.accountId ?? "";
  if (!accountId || !payload?.name) {
    return NextResponse.json({ ok: false, message: "Missing accountId or name" }, { status: 400 });
  }
  const accountContext = await requireAccountContext(request, accountId);
  if (accountContext instanceof NextResponse) return accountContext;
  const { account, clientId } = accountContext;
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

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
