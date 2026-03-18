import { NextResponse } from "next/server";
import {
  getAttachmentIds,
  updateMessageFlags,
  deleteMessageById
} from "@/lib/db";
import { withoutRecentFlag } from "@/lib/messageFlags";
import { deleteMessageFiles } from "@/lib/storage";
import { deleteImapMessage } from "@/lib/mail/imap";
import { findTrashFolder, resolveMessageTrashState } from "./trashUtils";
import {
  moveAndRelocateMessageWithFiles,
  requireImapMessageMutationContext,
  resolveSpecialFolderAndMailbox,
} from "../routeHelpers";

export async function handleDeleteMessageRequest(
  request: Request,
  options?: { accountId?: string | null; messageId?: string | null }
) {
  const payload = (await request.json().catch(() => null)) as
    | { accountId?: string; messageId?: string }
    | null;
  const context = await requireImapMessageMutationContext(request, {
    accountId: options?.accountId,
    messageId: options?.messageId
  });
  if (context instanceof NextResponse) return context;
  const { accountId, account, clientId, message } = context;

  const { folder: trashFolder, mailbox: trashMailbox } = await resolveSpecialFolderAndMailbox(
    accountId,
    findTrashFolder
  );
  if (!trashFolder) {
    return NextResponse.json({ ok: false, message: "Trash folder not found" }, { status: 400 });
  }
  const trashMailboxPath = trashMailbox ?? "Trash";
  const { currentMailbox, isInTrash } = resolveMessageTrashState(
    message,
    trashFolder,
    accountId
  );

  if (isInTrash) {
    await deleteImapMessage(account, currentMailbox, message.imapUid, clientId);
    const attachmentIds = await getAttachmentIds(accountId, message.id);
    await deleteMessageById(accountId, message.id);
    await deleteMessageFiles(accountId, message.id, attachmentIds);
    return NextResponse.json({ ok: true, action: "deleted" });
  }

  const { relocated } = await moveAndRelocateMessageWithFiles({
    account,
    currentMailbox,
    imapUid: message.imapUid,
    destinationMailbox: trashMailboxPath,
    clientId,
    accountId,
    previousId: message.id,
    destinationFolderId: trashFolder?.id ?? message.folderId
  });
  if (message.flags && message.flags.length > 0) {
    const cleaned = withoutRecentFlag(message.flags);
    if (cleaned.length !== message.flags.length) {
      await updateMessageFlags(accountId, relocated?.nextId ?? message.id, cleaned);
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

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
