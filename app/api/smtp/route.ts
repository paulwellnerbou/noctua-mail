import { NextResponse } from "next/server";
import { getAccounts, getFolders } from "@/lib/db";
import { appendImapMessage } from "@/lib/mail/imap";
import { sendSmtpMessage } from "@/lib/mail/smtp";
import type { Folder } from "@/lib/data";
import { requireSessionOr401 } from "@/lib/auth";

const SENT_NAMES = [
  "sent",
  "sent items",
  "sent mail",
  "sent messages",
  "gesendet",
  "gesendete",
  "gesendete objekte",
  "gesendete elemente",
  "outbox",
  "enviado",
  "envoyés",
  "gesendete nachrichten"
];

function folderMailboxPath(folder: Folder, accountId: string) {
  if (folder.id.startsWith(`${accountId}:`)) {
    return folder.id.slice(accountId.length + 1);
  }
  return folder.name;
}

function findSentMailbox(folders: Folder[], accountId: string) {
  const candidates = folders.filter((folder) => folder.accountId === accountId);
  const byName = candidates.find((folder) =>
    SENT_NAMES.includes(folder.name.trim().toLowerCase())
  );
  if (byName) return folderMailboxPath(byName, accountId);
  const byId = candidates.find((folder) =>
    SENT_NAMES.some((name) => folder.id.toLowerCase().includes(name))
  );
  if (byId) return folderMailboxPath(byId, accountId);
  const byPartial = candidates.find((folder) =>
    folder.name.toLowerCase().includes("sent")
  );
  if (byPartial) return folderMailboxPath(byPartial, accountId);
  return null;
}

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const payload = (await request.json()) as {
    accountId: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    text: string;
    html?: string;
    inReplyTo?: string;
    references?: string[];
    replyTo?: string;
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
          content: parsed.buffer as Buffer<ArrayBufferLike>,
          inline: Boolean(attachment.inline),
          cid: attachment.cid
        };
      })
      .filter(Boolean) as {
        filename: string;
        contentType: string;
        content: Buffer<ArrayBufferLike>;
        inline?: boolean;
        cid?: string;
      }[] ?? [];

  const result = await sendSmtpMessage(account, {
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    inReplyTo: payload.inReplyTo,
    references: payload.references,
    replyTo: payload.replyTo,
    ...(attachments.length > 0 ? { attachments } : {})
  });

  const folders = await getFolders(account.id);
  const sentMailbox = findSentMailbox(folders, account.id);
  if (sentMailbox) {
    try {
      await appendImapMessage(account, sentMailbox, result.raw, ["\\Seen"]);
    } catch {
      // ignore append failures
    }
  }

  return NextResponse.json({ ok: true });
}
