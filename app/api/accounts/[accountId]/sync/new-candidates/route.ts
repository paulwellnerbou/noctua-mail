import { NextResponse } from "next/server";
import { getFolders } from "@/lib/db";
import { planImapNewSyncFolders } from "@/lib/mail/imap";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { imapUpstreamErrorResponse } from "@/app/api/_helpers/imapUpstreamError";

type NewSyncCandidatesPayload = {
  accountId?: string;
  folderIds?: string[];
};

export async function POST(request: Request, { params }: AccountRouteParams) {
  const payload = (await request.json()) as NewSyncCandidatesPayload;
  const accountId = await getAccountIdFromParams(params);
  const accountContext = await requireAccountContext(request, accountId, {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  const { accountId: resolvedAccountId, account, clientId } = accountContext;

  const accountFolderIds = new Set(
    (await getFolders(resolvedAccountId))
      .filter((folder) => folder.accountId === resolvedAccountId)
      .map((folder) => folder.id)
  );
  const requestedFolderIds = Array.isArray(payload.folderIds)
    ? payload.folderIds.filter(
        (folderId): folderId is string =>
          typeof folderId === "string" && folderId.length > 0 && accountFolderIds.has(folderId)
      )
    : [];
  const folderIds = requestedFolderIds.length > 0 ? requestedFolderIds : Array.from(accountFolderIds);

  try {
    const decisions = await planImapNewSyncFolders(account, folderIds, clientId);
    return NextResponse.json({ ok: true, decisions });
  } catch (error) {
    return imapUpstreamErrorResponse(error, {
      accountId: resolvedAccountId,
      op: "sync.new-candidates"
    });
  }
}
