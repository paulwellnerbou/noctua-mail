import { NextResponse } from "next/server";
import {
  getAccounts,
  getFolders,
  getMessageById,
  updateMessageFolder,
  updateMessageFlags
} from "@/lib/db";
import { moveImapMessage, updateImapFlags } from "@/lib/mail/imap";
import type { Folder } from "@/lib/data";
import { requireAccountAccessOr403, requireSessionOr401 } from "@/lib/auth";

const NONJUNK_KEYWORD = "NONJUNK";

const normalizeKeyword = (value: string) => value.replace(/[\s-]/g, "").toLowerCase();
const isNonJunkKeyword = (value: string) => normalizeKeyword(value) === "nonjunk";

function folderMailboxPath(folder: Folder, accountId: string) {
  if (folder.id.startsWith(`${accountId}:`)) {
    return folder.id.slice(accountId.length + 1);
  }
  return folder.name;
}

function findInboxFolder(folders: Folder[], accountId: string) {
  const candidates = folders.filter((folder) => folder.accountId === accountId);
  const bySpecial = candidates.find(
    (folder) => (folder.specialUse ?? "").toLowerCase() === "\\inbox"
  );
  if (bySpecial) return bySpecial;
  const byName = candidates.find((folder) => folder.name.trim().toLowerCase() === "inbox");
  if (byName) return byName;
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
  const inboxFolder = findInboxFolder(folders, payload.accountId);
  const inboxMailbox = inboxFolder
    ? folderMailboxPath(inboxFolder, payload.accountId)
    : "INBOX";
  const currentMailbox =
    message.mailboxPath || mailboxPathFromFolderId(message.folderId, payload.accountId);

  const existingFlags = message.flags ?? [];
  const nonJunkFlags = existingFlags.filter(isNonJunkKeyword);
  if (nonJunkFlags.length > 0) {
    for (const flag of nonJunkFlags) {
      await updateImapFlags(account, currentMailbox, message.imapUid, flag, false, clientId);
    }
  }
  await updateImapFlags(
    account,
    currentMailbox,
    message.imapUid,
    NONJUNK_KEYWORD,
    true,
    clientId
  );

  const destinationUid = await moveImapMessage(
    account,
    currentMailbox,
    message.imapUid,
    inboxMailbox,
    clientId
  );
  if (inboxFolder) {
    await updateMessageFolder(
      payload.accountId,
      message.id,
      inboxFolder.id,
      inboxMailbox,
      destinationUid
    );
  }

  const cleanedFlags = existingFlags.filter(
    (flag) => !isNonJunkKeyword(flag) && flag.toLowerCase() !== "\\recent"
  );
  const nextFlags = [...cleanedFlags, NONJUNK_KEYWORD];
  const flagsChanged =
    nextFlags.length !== existingFlags.length ||
    nextFlags.some((flag, index) => flag !== existingFlags[index]);
  if (flagsChanged) {
    await updateMessageFlags(payload.accountId, message.id, nextFlags);
  }

  return NextResponse.json({
    ok: true,
    action: "moved",
    inboxFolderId: inboxFolder?.id ?? null,
    inboxMailbox,
    flags: nextFlags
  });
}
