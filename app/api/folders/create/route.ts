import { NextResponse } from "next/server";
import { getAccounts, getFolders, saveFolders } from "@/lib/db";
import { createImapFolder, listImapFolders } from "@/lib/mail/imap";
import { requireSessionOr401 } from "@/lib/auth";

export async function POST(request: Request) {
  const auth = await requireSessionOr401(request);
  if (auth instanceof NextResponse) return auth;
  const payload = (await request.json()) as {
    accountId: string;
    name: string;
    parentId?: string | null;
  };
  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === payload.accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  const folders = await getFolders(payload.accountId);
  const parent = payload.parentId
    ? folders.find((folder) => folder.id === payload.parentId)
    : null;
  const delimiter = parent?.delimiter ?? "/";
  const parentPath = parent ? parent.id.replace(`${payload.accountId}:`, "") : "";
  const path = parentPath ? `${parentPath}${delimiter}${payload.name}` : payload.name;

  await createImapFolder(account, path);
  const updated = await listImapFolders(account);
  const existing = await getFolders();
  const next = [...existing.filter((folder) => folder.accountId !== account.id), ...updated];
  await saveFolders(next);
  return NextResponse.json({ ok: true, folders: updated });
}
