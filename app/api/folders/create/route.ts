import { NextResponse } from "next/server";
import { getAccounts, getFolders, saveFoldersForAccount } from "@/lib/db";
import { createImapFolder, listImapFolders } from "@/lib/mail/imap";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";

export async function POST(request: Request) {
  const auth = await requireSessionOr401(request);
  if (auth instanceof NextResponse) return auth;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as {
    accountId: string;
    name: string;
    parentId?: string | null;
  };
  if (!payload?.accountId || !payload?.name) {
    return NextResponse.json({ ok: false, message: "Missing accountId or name" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(auth, payload.accountId);
  if (access instanceof NextResponse) return access;
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

  await createImapFolder(account, path, clientId);
  const updated = await listImapFolders(account, clientId);
  await saveFoldersForAccount(account.id, updated);
  return NextResponse.json({ ok: true, folders: updated });
}
