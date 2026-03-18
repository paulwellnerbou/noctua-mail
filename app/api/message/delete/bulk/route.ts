import { NextResponse } from "next/server";
import {
  deleteMessagesByIds,
  getFolders,
  getMessageById,
  listMessageFileRefsByMessageIds
} from "@/lib/db";
import { deleteImapMessages } from "@/lib/mail/imap";
import { deleteMessageFiles } from "@/lib/storage";
import { requireAccountContext } from "../../routeHelpers";
import { findTrashFolder, resolveMessageTrashState } from "../trashUtils";

type BulkDeletePayload = {
  accountId?: string;
  messageIds?: string[];
};

export async function handleBulkDeleteMessagesRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const payload = (await request.json().catch(() => null)) as BulkDeletePayload | null;
  const accountId = options?.accountId ?? "";

  const normalizedMessageIds = Array.from(
    new Set((payload?.messageIds ?? []).map((id) => id.trim()).filter(Boolean))
  );
  if (!accountId || normalizedMessageIds.length === 0) {
    return NextResponse.json(
      { ok: false, message: "Missing accountId or messageIds" },
      { status: 400 }
    );
  }
  const accountContext = await requireAccountContext(request, accountId);
  if (accountContext instanceof NextResponse) return accountContext;
  const { account, clientId } = accountContext;

  const folders = await getFolders(accountId);
  const trashFolder = findTrashFolder(folders, accountId);
  if (!trashFolder) {
    return NextResponse.json({ ok: false, message: "Trash folder not found" }, { status: 400 });
  }

  const messages = await Promise.all(
    normalizedMessageIds.map((messageId) => getMessageById(accountId, messageId))
  );
  const existingMessages = messages.filter((message): message is NonNullable<typeof message> =>
    Boolean(message)
  );
  if (existingMessages.length !== normalizedMessageIds.length) {
    return NextResponse.json(
      { ok: false, message: "One or more messages were not found" },
      { status: 404 }
    );
  }

  const deleteTargets: Array<{ mailboxPath: string; uid: number; messageId: string }> = [];
  for (const message of existingMessages) {
    const { currentMailbox, isInTrash } = resolveMessageTrashState(
      message,
      trashFolder,
      accountId
    );
    if (!isInTrash) {
      return NextResponse.json(
        { ok: false, message: "Bulk delete only supports messages already in Trash" },
        { status: 400 }
      );
    }
    if (typeof message.imapUid !== "number" || !Number.isFinite(message.imapUid) || !currentMailbox) {
      return NextResponse.json(
        { ok: false, message: "One or more messages are missing IMAP metadata" },
        { status: 400 }
      );
    }
    deleteTargets.push({
      mailboxPath: currentMailbox,
      uid: message.imapUid,
      messageId: message.id
    });
  }

  await deleteImapMessages(
    account,
    deleteTargets.map((item) => ({ mailboxPath: item.mailboxPath, uid: item.uid })),
    clientId
  );

  const deletedIds = deleteTargets.map((item) => item.messageId);
  const fileRefs = await listMessageFileRefsByMessageIds(accountId, deletedIds);
  await deleteMessagesByIds(accountId, deletedIds);
  await Promise.all(
    fileRefs.map((item) => deleteMessageFiles(accountId, item.messageId, item.attachmentIds))
  );

  return NextResponse.json({
    ok: true,
    action: "deleted",
    deleted: deletedIds.length,
    deletedIds
  });
}

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
