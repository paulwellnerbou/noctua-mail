import { NextResponse } from "next/server";
import { findArchiveFolder } from "@/lib/specialFolders";
import {
  moveAndRelocateMessageWithFiles,
  requireImapMessageMutationContext,
  resolveSpecialFolderAndMailbox
} from "@/app/api/_helpers/message/routeHelpers";
import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";

type Params = AccountRouteParams & {
  params: Promise<{ id?: string; accountId?: string; messageId?: string }>;
};

export async function POST(request: Request, { params }: Params) {
  const accountId = await getAccountIdFromParams(params);
  const { messageId: rawMessageId } = await params;
  const messageId = typeof rawMessageId === "string" ? rawMessageId.trim() : "";
  const context = await requireImapMessageMutationContext(request, { accountId, messageId });
  if (context instanceof NextResponse) return context;
  const { accountId: resolvedAccountId, account, clientId, message } = context;

  const { folder: archiveFolder, mailbox: archiveMailbox } = await resolveSpecialFolderAndMailbox(
    resolvedAccountId,
    findArchiveFolder,
    { fallbackMailbox: "Archive" }
  );
  const archiveMailboxPath = archiveMailbox ?? "Archive";
  const currentMailbox = message.mailboxPath;

  const { relocated } = await moveAndRelocateMessageWithFiles({
    account,
    currentMailbox,
    imapUid: message.imapUid,
    destinationMailbox: archiveMailboxPath,
    clientId,
    accountId: resolvedAccountId,
    previousId: message.id,
    destinationFolderId: archiveFolder?.id ?? message.folderId
  });
  return NextResponse.json({
    ok: true,
    action: "moved",
    archiveFolderId: archiveFolder?.id ?? null,
    archiveMailbox: archiveMailboxPath,
    previousMessageId: relocated?.previousId ?? message.id,
    messageId: relocated?.nextId ?? message.id
  });
}
