import { NextResponse } from "next/server";
import {
  deleteMessagesByIds,
  getAccounts,
  getFolders,
  getMessageById,
  listMessageFileRefsByMessageIds
} from "@/lib/db";
import { deleteImapMessages } from "@/lib/mail/imap";
import { deleteMessageFiles } from "@/lib/storage";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";
import { findTrashFolder, mailboxPathFromFolderId } from "../trashUtils";

type BulkDeletePayload = {
  accountId: string;
  messageIds: string[];
};

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as BulkDeletePayload;

  const normalizedMessageIds = Array.from(
    new Set((payload?.messageIds ?? []).map((id) => id.trim()).filter(Boolean))
  );
  if (!payload?.accountId || normalizedMessageIds.length === 0) {
    return NextResponse.json(
      { ok: false, message: "Missing accountId or messageIds" },
      { status: 400 }
    );
  }
  const access = await requireSessionAccountOr403(session, payload.accountId);
  if (access instanceof NextResponse) return access;

  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === payload.accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }

  const folders = await getFolders(payload.accountId);
  const trashFolder = findTrashFolder(folders, payload.accountId);
  if (!trashFolder) {
    return NextResponse.json({ ok: false, message: "Trash folder not found" }, { status: 400 });
  }
  const trashMailbox = mailboxPathFromFolderId(trashFolder.id, payload.accountId);
  const trashDelimiter = trashFolder.delimiter ?? "/";

  const messages = await Promise.all(
    normalizedMessageIds.map((messageId) => getMessageById(payload.accountId, messageId))
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
    const currentMailbox =
      message.mailboxPath || mailboxPathFromFolderId(message.folderId, payload.accountId);
    const isInTrash =
      message.folderId === trashFolder.id ||
      currentMailbox === trashMailbox ||
      currentMailbox.startsWith(`${trashMailbox}${trashDelimiter}`);
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
  const fileRefs = await listMessageFileRefsByMessageIds(payload.accountId, deletedIds);
  await deleteMessagesByIds(payload.accountId, deletedIds);
  await Promise.all(
    fileRefs.map((item) => deleteMessageFiles(payload.accountId, item.messageId, item.attachmentIds))
  );

  return NextResponse.json({
    ok: true,
    action: "deleted",
    deleted: deletedIds.length,
    deletedIds
  });
}
