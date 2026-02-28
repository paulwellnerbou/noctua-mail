import { NextResponse } from "next/server";
import { findArchiveFolder } from "@/lib/specialFolders";
import {
  moveAndRelocateMessageWithFiles,
  requireImapMessageMutationContext,
  resolveSpecialFolderAndMailbox,
} from "../routeHelpers";

export async function POST(request: Request) {
  const payload = (await request.json()) as { accountId: string; messageId: string };
  const context = await requireImapMessageMutationContext(request, payload);
  if (context instanceof NextResponse) return context;
  const { accountId, account, clientId, message } = context;

  const { folder: archiveFolder, mailbox: archiveMailbox } = await resolveSpecialFolderAndMailbox(
    accountId,
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
    accountId,
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
