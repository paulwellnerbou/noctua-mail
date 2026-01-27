import { NextResponse } from "next/server";
import {
  deleteMessageById,
  getAccounts,
  getFolders,
  getMessageById,
  upsertMessages
} from "@/lib/db";
import { appendImapMessage, deleteImapMessage, syncImapMessage } from "@/lib/mail/imap";
import { buildRawMessage } from "@/lib/mail/smtp";
import type { Folder } from "@/lib/data";

const DRAFT_NAMES = [
  "drafts",
  "draft",
  "entwürfe",
  "entwuerfe",
  "entwurf",
  "brouillons",
  "borradores"
];

function folderMailboxPath(folder: Folder, accountId: string) {
  if (folder.id.startsWith(`${accountId}:`)) {
    return folder.id.slice(accountId.length + 1);
  }
  return folder.name;
}

function findDraftsFolder(folders: Folder[], accountId: string) {
  const candidates = folders.filter((folder) => folder.accountId === accountId);
  const bySpecial = candidates.find(
    (folder) => (folder.specialUse ?? "").toLowerCase() === "\\drafts"
  );
  if (bySpecial) return bySpecial;
  const byName = candidates.find((folder) =>
    DRAFT_NAMES.includes(folder.name.trim().toLowerCase())
  );
  if (byName) return byName;
  const byId = candidates.find((folder) =>
    DRAFT_NAMES.some((name) => folder.id.toLowerCase().includes(name))
  );
  if (byId) return byId;
  return candidates.find((folder) => folder.name.toLowerCase().includes("draft")) ?? null;
}

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    accountId: string;
    draftId?: string | null;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    text: string;
    html?: string;
    inReplyTo?: string;
    references?: string[];
    xForwardedMessageId?: string;
    attachments?: Array<{
      filename: string;
      contentType: string;
      inline?: boolean;
      cid?: string;
      dataUrl?: string;
    }>;
  };
  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === payload.accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  const folders = await getFolders(account.id);
  const draftsFolder = findDraftsFolder(folders, account.id);
  if (!draftsFolder) {
    return NextResponse.json(
      { ok: false, message: "Drafts folder not found" },
      { status: 400 }
    );
  }
  const draftsMailbox = folderMailboxPath(draftsFolder, account.id);
  const parseDataUrl = (dataUrl: string) => {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const buffer = Buffer.from(match[2], "base64");
    return { contentType: match[1], buffer };
  };
  const attachments =
    payload.attachments
      ?.map((attachment) => {
        if (!attachment.dataUrl) return null;
        const parsed = parseDataUrl(attachment.dataUrl);
        if (!parsed) return null;
        return {
          filename: attachment.filename,
          contentType: attachment.contentType || parsed.contentType,
          content: parsed.buffer,
          inline: attachment.inline ?? false,
          cid: attachment.cid
        };
      })
      .filter(Boolean) ?? [];

  const raw = await buildRawMessage(account, {
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    inReplyTo: payload.inReplyTo,
    references: payload.references,
    xForwardedMessageId: payload.xForwardedMessageId,
    ...(attachments.length > 0 ? { attachments } : {})
  });

  if (payload.draftId) {
    const existing = await getMessageById(payload.accountId, payload.draftId);
    if (existing?.imapUid && existing.mailboxPath) {
      await deleteImapMessage(account, existing.mailboxPath, existing.imapUid);
    }
    if (existing) {
      await deleteMessageById(payload.accountId, existing.id);
    }
  }

  const uid = await appendImapMessage(account, draftsMailbox, raw, ["\\Draft"]);
  let messageId: string | null = null;
  if (uid) {
    const message = await syncImapMessage(account, draftsMailbox, uid);
    if (message) {
      // Preserve existing draft id so the frontend keeps editing the same draft entry
      if (payload.draftId) {
        message.id = payload.draftId;
      }
      await upsertMessages(account.id, null, [message], false);
      messageId = message.id;
    }
  }

  return NextResponse.json({ ok: true, draftId: messageId });
}
