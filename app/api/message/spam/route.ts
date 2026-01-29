import { NextResponse } from "next/server";
import {
  getAccounts,
  getFolders,
  getMessageById,
  updateMessageFolder
} from "@/lib/db";
import { moveImapMessage } from "@/lib/mail/imap";
import type { Folder } from "@/lib/data";
import { requireSessionOr401 } from "@/lib/auth";

const JUNK_NAMES = [
  "junk",
  "spam",
  "junk email",
  "junk e-mail",
  "bulk",
  "spam mail",
  "spam messages"
];

function folderMailboxPath(folder: Folder, accountId: string) {
  if (folder.id.startsWith(`${accountId}:`)) {
    return folder.id.slice(accountId.length + 1);
  }
  return folder.name;
}

function findJunkFolder(folders: Folder[], accountId: string) {
  const candidates = folders.filter((folder) => folder.accountId === accountId);
  const bySpecial = candidates.find((folder) => {
    const special = (folder.specialUse ?? "").toLowerCase();
    return special === "\\junk" || special === "\\spam";
  });
  if (bySpecial) return bySpecial;
  const byName = candidates.find((folder) =>
    JUNK_NAMES.includes(folder.name.trim().toLowerCase())
  );
  if (byName) return byName;
  const byId = candidates.find((folder) =>
    JUNK_NAMES.some((name) => folder.id.toLowerCase().includes(name))
  );
  if (byId) return byId;
  const byPartial = candidates.find((folder) =>
    folder.name.toLowerCase().includes("junk") || folder.name.toLowerCase().includes("spam")
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
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
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
  const junkFolder = findJunkFolder(folders, payload.accountId);
  const junkMailbox = junkFolder ? folderMailboxPath(junkFolder, payload.accountId) : "Junk";
  const currentMailbox =
    message.mailboxPath || mailboxPathFromFolderId(message.folderId, payload.accountId);

  await moveImapMessage(account, currentMailbox, message.imapUid, junkMailbox, clientId);
  if (junkFolder) {
    await updateMessageFolder(payload.accountId, message.id, junkFolder.id, junkMailbox);
  }
  return NextResponse.json({
    ok: true,
    action: "moved",
    junkFolderId: junkFolder?.id ?? null,
    junkMailbox
  });
}
