import { NextResponse } from "next/server";
import {
  deleteMessagesByIds,
  getFolders,
  getStoredMessagesByIds,
  listMessageFileRefsByMessageIds
} from "@/lib/db";
import { deleteImapMessages } from "@/lib/mail/imap";
import { deleteMessageFiles } from "@/lib/storage";
import { requireAccountContext } from "@/app/api/_helpers/message/routeHelpers";
import { findTrashFolder, resolveMessageTrashState } from "@/app/api/_helpers/message/trashUtils";
import { getAccountIdFromParams, type AccountRouteParams } from "@/app/api/_helpers/accountContext";

type BulkDeletePayload = {
  accountId?: string;
  messageIds?: string[];
};

export async function POST(request: Request, { params }: AccountRouteParams) {
  const payload = (await request.json().catch(() => null)) as BulkDeletePayload | null;
  const accountId = await getAccountIdFromParams(params);

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

  const existingMessages = await getStoredMessagesByIds(accountId, normalizedMessageIds);
  if (existingMessages.length !== normalizedMessageIds.length) {
    return NextResponse.json(
      { ok: false, message: "One or more messages were not found" },
      { status: 404 }
    );
  }

  const deleteTargets: Array<{ mailboxPath: string; uid: number; messageId: string }> = [];
  for (const message of existingMessages) {
    const { currentMailbox, isInTrash } = resolveMessageTrashState(
      { folderId: message.folderId, mailboxPath: message.mailboxPath ?? undefined },
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
  const fileResults = await Promise.allSettled(
    fileRefs.map((item) => deleteMessageFiles(accountId, item.messageId, item.attachmentIds))
  );
  for (const r of fileResults) {
    if (r.status === "rejected") {
      console.error("[bulk-delete] file cleanup failed:", r.reason);
    }
  }

  return NextResponse.json({
    ok: true,
    action: "deleted",
    deleted: deletedIds.length,
    deletedIds
  });
}
