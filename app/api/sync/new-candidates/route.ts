import { NextResponse } from "next/server";
import { requireAccountAccessOr403, requireSessionOr401 } from "@/lib/auth";
import { getAccounts, getFolders } from "@/lib/db";
import { planImapNewSyncFolders } from "@/lib/mail/imap";

type NewSyncCandidatesPayload = {
  accountId?: string;
  folderIds?: string[];
};

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as NewSyncCandidatesPayload;

  const accountId = payload?.accountId;
  if (!accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const access = await requireAccountAccessOr403(session, accountId);
  if (access instanceof NextResponse) return access;

  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }

  const accountFolderIds = new Set(
    (await getFolders(accountId)).filter((folder) => folder.accountId === accountId).map((folder) => folder.id)
  );
  const requestedFolderIds = Array.isArray(payload.folderIds)
    ? payload.folderIds.filter(
        (folderId): folderId is string =>
          typeof folderId === "string" && folderId.length > 0 && accountFolderIds.has(folderId)
      )
    : [];
  const folderIds = requestedFolderIds.length > 0 ? requestedFolderIds : Array.from(accountFolderIds);

  const decisions = await planImapNewSyncFolders(account, folderIds, clientId);
  return NextResponse.json({ ok: true, decisions });
}
