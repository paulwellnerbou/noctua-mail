import { NextResponse } from "next/server";
import { getAccounts, getFolders, saveFoldersForAccount, updateMessagesFolderPrefix } from "@/lib/db";
import { listImapFolders, renameImapFolder } from "@/lib/mail/imap";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";

export async function POST(request: Request) {
  const auth = await requireSessionOr401(request);
  if (auth instanceof NextResponse) return auth;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as {
    accountId: string;
    folderId: string;
    name: string;
  };
  if (!payload?.accountId || !payload?.folderId || !payload?.name) {
    return NextResponse.json({ ok: false, message: "Missing accountId, folderId, or name" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(auth, payload.accountId);
  if (access instanceof NextResponse) return access;
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
  const delimiter = folder.delimiter ?? "/";
  const mailboxPath = folder.id.replace(`${payload.accountId}:`, "");
  const parts = mailboxPath.split(delimiter);
  parts[parts.length - 1] = payload.name;
  const newPath = parts.join(delimiter);

  await renameImapFolder(account, mailboxPath, newPath, clientId);
  await updateMessagesFolderPrefix(payload.accountId, mailboxPath, newPath);
  const updated = await listImapFolders(account, clientId);
  await saveFoldersForAccount(account.id, updated);
  return NextResponse.json({ ok: true, folders: updated });
}
