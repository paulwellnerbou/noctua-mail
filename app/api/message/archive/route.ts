import { NextResponse } from "next/server";
import {
  getAccounts,
  getFolders,
  getMessageById,
  relocateMovedMessage
} from "@/lib/db";
import { moveImapMessage } from "@/lib/mail/imap";
import { moveMessageFiles } from "@/lib/storage";
import type { Folder } from "@/lib/data";
import { requireAccountAccessOr403, requireSessionOr401 } from "@/lib/auth";

const ARCHIVE_NAMES = ["archive", "archiv", "archives", "archivio", "archivos"];

function folderMailboxPath(folder: Folder, accountId: string) {
  if (folder.id.startsWith(`${accountId}:`)) {
    return folder.id.slice(accountId.length + 1);
  }
  return folder.name;
}

function findArchiveFolder(folders: Folder[], accountId: string) {
  const candidates = folders.filter((folder) => folder.accountId === accountId);
  const bySpecial = candidates.find((folder) => {
    const special = (folder.specialUse ?? "").toLowerCase();
    return special === "\\archive";
  });
  if (bySpecial) return bySpecial;
  const byName = candidates.find((folder) =>
    ARCHIVE_NAMES.includes(folder.name.trim().toLowerCase())
  );
  if (byName) return byName;
  const byId = candidates.find((folder) =>
    ARCHIVE_NAMES.some((name) => folder.id.toLowerCase().includes(name))
  );
  if (byId) return byId;
  return null;
}

function mailboxPathFromFolderId(folderId: string, accountId: string) {
  if (folderId.startsWith(`${accountId}:`)) {
    return folderId.slice(accountId.length + 1);
  }
  return folderId;
}

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as { accountId: string; messageId: string };
  if (!payload?.accountId || !payload?.messageId) {
    return NextResponse.json({ ok: false, message: "Missing accountId or messageId" }, { status: 400 });
  }
  const access = await requireAccountAccessOr403(session, payload.accountId);
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
  const archiveFolder = findArchiveFolder(folders, payload.accountId);
  const archiveMailbox = archiveFolder
    ? folderMailboxPath(archiveFolder, payload.accountId)
    : "Archive";
  const currentMailbox =
    message.mailboxPath || mailboxPathFromFolderId(message.folderId, payload.accountId);

  const destinationUid = await moveImapMessage(
    account,
    currentMailbox,
    message.imapUid,
    archiveMailbox,
    clientId
  );
  const relocated = await relocateMovedMessage({
    accountId: payload.accountId,
    previousId: message.id,
    destinationFolderId: archiveFolder?.id ?? message.folderId,
    destinationMailboxPath: archiveMailbox,
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
  return NextResponse.json({
    ok: true,
    action: "moved",
    archiveFolderId: archiveFolder?.id ?? null,
    archiveMailbox,
    previousMessageId: relocated?.previousId ?? message.id,
    messageId: relocated?.nextId ?? message.id
  });
}
