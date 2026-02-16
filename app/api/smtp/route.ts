import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getAccounts, getFolders } from "@/lib/db";
import { appendImapMessage } from "@/lib/mail/imap";
import { parseComposeAttachments, resolveComposeHtml } from "@/lib/mail/composePayload";
import { sendSmtpMessage } from "@/lib/mail/smtp";
import type { Folder } from "@/lib/data";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";

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

function buildMessageId(address: string) {
  const domain = address.split("@")[1]?.trim();
  const safeDomain = domain && domain.length > 0 ? domain : "noctua.local";
  return `<${randomUUID()}@${safeDomain}>`;
}

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
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as {
    accountId: string;
    to?: string;
    cc?: string;
    bcc?: string;
    subject: string;
    text: string;
    markdown?: string;
    html?: string;
    composeFormat?: string;
    inReplyTo?: string;
    references?: string[];
    replyTo?: string;
    xForwardedMessageId?: string;
    attachments?: Array<{
      filename: string;
      contentType: string;
      inline?: boolean;
      cid?: string;
      dataUrl?: string;
    }>;
  };
  if (!payload?.accountId) {
    return NextResponse.json({ ok: false, message: "Missing accountId" }, { status: 400 });
  }
  const access = await requireSessionAccountOr403(session, payload.accountId);
  if (access instanceof NextResponse) return access;
  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === payload.accountId);

  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }
  const to = payload.to?.trim() ?? "";
  const cc = payload.cc?.trim() ?? "";
  const bcc = payload.bcc?.trim() ?? "";
  if (!to && !cc && !bcc) {
    return NextResponse.json(
      { ok: false, message: "Please add at least one recipient." },
      { status: 400 }
    );
  }
  const outboundTo = !to && !cc && bcc ? "undisclosed-recipients:;" : to;

  const attachments = parseComposeAttachments(payload.attachments);
  const html = await resolveComposeHtml({
    composeFormat: payload.composeFormat,
    markdown: payload.markdown,
    html: payload.html,
    attachments: payload.attachments
  });

  const messageId = buildMessageId(account.email);
  const result = await sendSmtpMessage(account, {
    to: outboundTo || undefined,
    cc: cc || undefined,
    bcc: bcc || undefined,
    keepBcc: true,
    subject: payload.subject,
    text: payload.text,
    html,
    messageId,
    inReplyTo: payload.inReplyTo,
    references: payload.references,
    replyTo: payload.replyTo,
    xForwardedMessageId: payload.xForwardedMessageId,
    ...(attachments.length > 0 ? { attachments } : {})
  });

  const folders = await getFolders(account.id);
  const sentMailbox = findSentMailbox(folders, account.id);
  if (sentMailbox) {
    try {
      await appendImapMessage(account, sentMailbox, result.raw, ["\\Seen"], clientId);
    } catch {
      // ignore append failures
    }
  }

  return NextResponse.json({ ok: true });
}
