import { NextResponse } from "next/server";
import {
  getAccounts,
  getAttachmentIds,
  getFolders,
  getMessageById,
  relocateMovedMessage,
  updateMessageFlags,
  deleteMessageById
} from "@/lib/db";
import { deleteMessageFiles, moveMessageFiles } from "@/lib/storage";
import { deleteImapMessage, moveImapMessage } from "@/lib/mail/imap";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";
import { findTrashFolder, folderMailboxPath, mailboxPathFromFolderId } from "./trashUtils";

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as { accountId: string; messageId: string };
  if (!payload?.accountId || !payload?.messageId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or messageId" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(session, payload.accountId);
  if (access instanceof NextResponse) return access;
  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === payload.accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }

  const message = await getMessageById(payload.accountId, payload.messageId);
  if (!message) {
    return NextResponse.json({ ok: false, message: "Message not found" }, { status: 404 });
  }
  if (!message.imapUid || !message.mailboxPath) {
    return NextResponse.json(
      { ok: false, message: "Message is missing IMAP metadata" },
      { status: 400 }
    );
  }

  const folders = await getFolders(payload.accountId);
  const trashFolder = findTrashFolder(folders, payload.accountId);
  if (!trashFolder) {
    return NextResponse.json({ ok: false, message: "Trash folder not found" }, { status: 400 });
  }
  const trashMailbox = folderMailboxPath(trashFolder, payload.accountId);
  const currentMailbox = message.mailboxPath || mailboxPathFromFolderId(message.folderId, payload.accountId);
  const delimiter = trashFolder.delimiter ?? "/";
  const isInTrash =
    message.folderId === trashFolder.id ||
    currentMailbox === trashMailbox ||
    currentMailbox.startsWith(`${trashMailbox}${delimiter}`);

  if (isInTrash) {
    await deleteImapMessage(account, currentMailbox, message.imapUid, clientId);
    const attachmentIds = await getAttachmentIds(payload.accountId, message.id);
    await deleteMessageById(payload.accountId, message.id);
    await deleteMessageFiles(payload.accountId, message.id, attachmentIds);
    return NextResponse.json({ ok: true, action: "deleted" });
  }

  const destinationUid = await moveImapMessage(
    account,
    currentMailbox,
    message.imapUid,
    trashMailbox,
    clientId
  );
  const relocated = await relocateMovedMessage({
    accountId: payload.accountId,
    previousId: message.id,
    destinationFolderId: trashFolder?.id ?? message.folderId,
    destinationMailboxPath: trashMailbox,
    destinationUid
  });
  if (relocated?.changed) {
    await moveMessageFiles(
      payload.accountId,
      relocated.previousId,
      relocated.nextId,
      relocated.attachmentIds
    );
  }
  if (message.flags && message.flags.length > 0) {
    const cleaned = message.flags.filter(
      (flag) => flag.toLowerCase() !== "\\recent"
    );
    if (cleaned.length !== message.flags.length) {
      await updateMessageFlags(payload.accountId, relocated?.nextId ?? message.id, cleaned);
    }
  }
  return NextResponse.json({
    ok: true,
    action: "moved",
    trashFolderId: trashFolder?.id ?? null,
    trashMailbox,
    previousMessageId: relocated?.previousId ?? message.id,
    messageId: relocated?.nextId ?? message.id
  });
}
