import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getFolders } from "@/lib/db";
import { appendImapMessage } from "@/lib/mail/imap";
import { parseComposeAttachments, resolveComposeHtml } from "@/lib/mail/composePayload";
import { sendSmtpMessage } from "@/lib/mail/smtp";
import { folderMailboxPath } from "@/lib/mailboxPaths";
import { findSentFolder } from "@/lib/specialFolders";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";

function buildMessageId(address: string) {
  const domain = address.split("@")[1]?.trim();
  const safeDomain = domain && domain.length > 0 ? domain : "noctua.local";
  return `<${randomUUID()}@${safeDomain}>`;
}

export async function POST(request: Request) {
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
  const accountContext = await requireAccountContext(request, payload?.accountId ?? "", {
    missingAccountMessage: "Missing accountId"
  });
  if (accountContext instanceof NextResponse) return accountContext;
  const { account, clientId } = accountContext;
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
  const sentFolder = findSentFolder(folders, account.id);
  const sentMailbox = sentFolder ? folderMailboxPath(sentFolder, account.id) : null;
  if (sentMailbox) {
    try {
      await appendImapMessage(account, sentMailbox, result.raw, ["\\Seen"], clientId);
    } catch {
      // ignore append failures
    }
  }

  return NextResponse.json({ ok: true });
}
