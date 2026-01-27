import { NextResponse } from "next/server";

import {
  getAccounts,
  getFolders,
  getMessageById,
  updateMessageFolder
} from "@/lib/db";
import { moveImapMessage } from "@/lib/mail/imap";
import type { Folder } from "@/lib/data";

type MovePayload = {
  accountId: string;
  messageIds: string[];
  destinationFolderId: string;
};

function mailboxPathFromFolder(folder: Folder, accountId: string) {
  if (folder.id.startsWith(`${accountId}:`)) {
    return folder.id.slice(accountId.length + 1);
  }
  return folder.name;
}

export async function POST(request: Request) {
  const payload = (await request.json()) as MovePayload;
  const { accountId, messageIds, destinationFolderId } = payload;

  if (!accountId || !Array.isArray(messageIds) || messageIds.length === 0 || !destinationFolderId) {
    return NextResponse.json({ ok: false, message: "Invalid payload" }, { status: 400 });
  }

  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }

  const folders = await getFolders(accountId);
  const destinationFolder = folders.find((folder) => folder.id === destinationFolderId);
  if (!destinationFolder) {
    return NextResponse.json(
      { ok: false, message: "Destination folder not found" },
      { status: 404 }
    );
  }

  const destinationMailbox = mailboxPathFromFolder(destinationFolder, accountId);

  for (const messageId of messageIds) {
    const message = await getMessageById(accountId, messageId);
    if (!message) continue;
    if (typeof message.imapUid !== "number" || !message.mailboxPath) continue;

    try {
      await moveImapMessage(account, message.mailboxPath, message.imapUid, destinationMailbox);
      await updateMessageFolder(accountId, message.id, destinationFolderId, destinationMailbox);
    } catch (error) {
      return NextResponse.json(
        { ok: false, message: (error as Error).message ?? "Failed to move message" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    destinationFolderId,
    destinationMailbox,
    moved: messageIds.length
  });
}
