import { NextResponse } from "next/server";
import { getFolders } from "@/lib/db";
import { planImapNewSyncFolders } from "@/lib/mail/imap";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";

type NewSyncCandidatesPayload = {
  accountId?: string;
  folderIds?: string[];
};

export async function POST(request: Request) {
  const payload = (await request.json()) as NewSyncCandidatesPayload;

  const accountContext = await requireAccountContext(request, payload?.accountId ?? "", {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  const { accountId, account, clientId } = accountContext;

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
