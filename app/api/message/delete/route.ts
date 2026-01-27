import { NextResponse } from "next/server";
import {
  getAccounts,
  getAttachmentIds,
  getFolders,
  getMessageById,
  updateMessageFolder,
  updateMessageFlags,
  deleteMessageById
} from "@/lib/db";
import { deleteMessageFiles } from "@/lib/storage";
import { deleteImapMessage, moveImapMessage } from "@/lib/mail/imap";
import type { Folder } from "@/lib/data";

const TRASH_NAMES = [
  "trash",
  "deleted",
  "deleted items",
  "deleted messages",
  "bin",
  "wastebasket",
  "papierkorb",
  "corbeille",
  "corbeille papier"
];

function folderMailboxPath(folder: Folder, accountId: string) {
  if (folder.id.startsWith(`${accountId}:`)) {
    return folder.id.slice(accountId.length + 1);
  }
  return folder.name;
}

function findTrashFolder(folders: Folder[], accountId: string) {
  const candidates = folders.filter((folder) => folder.accountId === accountId);
  const byName = candidates.find((folder) =>
    TRASH_NAMES.includes(folder.name.trim().toLowerCase())
  );
  if (byName) return byName;
  const byId = candidates.find((folder) =>
    TRASH_NAMES.some((name) => folder.id.toLowerCase().includes(name))
  );
  if (byId) return byId;
  const byPartial = candidates.find((folder) =>
    folder.name.toLowerCase().includes("trash") || folder.name.toLowerCase().includes("deleted")
  );
  if (byPartial) return byPartial;
  return null;
}

function mailboxPathFromFolderId(folderId: string, accountId: string) {
  if (folderId.startsWith(`${accountId}:`)) {
    return folderId.slice(accountId.length + 1);
  }
  return folderId;
}

export async function POST(request: Request) {
  const payload = (await request.json()) as { accountId: string; messageId: string };
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
  const trashMailbox = trashFolder
    ? folderMailboxPath(trashFolder, payload.accountId)
    : "Trash";
  const currentMailbox = message.mailboxPath || mailboxPathFromFolderId(message.folderId, payload.accountId);
  const isInTrash = trashFolder ? message.folderId === trashFolder.id : currentMailbox.toLowerCase().includes("trash");

  if (isInTrash) {
    await deleteImapMessage(account, currentMailbox, message.imapUid);
    const attachmentIds = await getAttachmentIds(message.id);
    await deleteMessageById(payload.accountId, message.id);
    await deleteMessageFiles(payload.accountId, message.id, attachmentIds);
    return NextResponse.json({ ok: true, action: "deleted" });
  }

  await moveImapMessage(account, currentMailbox, message.imapUid, trashMailbox);
  if (trashFolder) {
    await updateMessageFolder(payload.accountId, message.id, trashFolder.id, trashMailbox);
  }
  if (message.flags && message.flags.length > 0) {
    const cleaned = message.flags.filter(
      (flag) => flag.toLowerCase() !== "\\recent"
    );
    if (cleaned.length !== message.flags.length) {
      await updateMessageFlags(payload.accountId, message.id, cleaned);
    }
  }
  return NextResponse.json({
    ok: true,
    action: "moved",
    trashFolderId: trashFolder?.id ?? null,
    trashMailbox
  });
}
