import { NextResponse } from "next/server";
import {
  getAttachmentIds,
  updateMessageFlags,
  deleteMessageById
} from "@/lib/db";
import { withoutRecentFlag } from "@/lib/messageFlags";
import { deleteMessageFiles } from "@/lib/storage";
import { deleteImapMessage } from "@/lib/mail/imap";
import { findTrashFolder, resolveMessageTrashState } from "@/app/api/_helpers/message/trashUtils";
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

  const { folder: trashFolder, mailbox: trashMailbox } = await resolveSpecialFolderAndMailbox(
    resolvedAccountId,
    findTrashFolder
  );
  if (!trashFolder) {
    return NextResponse.json({ ok: false, message: "Trash folder not found" }, { status: 400 });
  }
  const trashMailboxPath = trashMailbox ?? "Trash";
  const { currentMailbox, isInTrash } = resolveMessageTrashState(
    message,
    trashFolder,
    resolvedAccountId
  );

  if (isInTrash) {
    await deleteImapMessage(account, currentMailbox, message.imapUid, clientId);
    const attachmentIds = await getAttachmentIds(resolvedAccountId, message.id);
    await deleteMessageById(resolvedAccountId, message.id);
    await deleteMessageFiles(resolvedAccountId, message.id, attachmentIds);
    return NextResponse.json({ ok: true, action: "deleted" });
  }

  const { relocated } = await moveAndRelocateMessageWithFiles({
    account,
    currentMailbox,
    imapUid: message.imapUid,
    destinationMailbox: trashMailboxPath,
    clientId,
    accountId: resolvedAccountId,
    previousId: message.id,
    destinationFolderId: trashFolder?.id ?? message.folderId
  });
  if (message.flags && message.flags.length > 0) {
    const cleaned = withoutRecentFlag(message.flags);
    if (cleaned.length !== message.flags.length) {
      await updateMessageFlags(resolvedAccountId, relocated?.nextId ?? message.id, cleaned);
    }
  }
  return NextResponse.json({
    ok: true,
    action: "moved",
    trashFolderId: trashFolder?.id ?? null,
    trashMailbox: trashMailboxPath,
    previousMessageId: relocated?.previousId ?? message.id,
    messageId: relocated?.nextId ?? message.id
  });
}
