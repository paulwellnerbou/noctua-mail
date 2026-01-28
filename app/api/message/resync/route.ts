import { NextResponse } from "next/server";
import { getAccounts, getMessageById, getThreadIdsByMessageIds, upsertMessages } from "@/lib/db";
import { saveAttachmentData, saveMessageSource } from "@/lib/storage";
import { syncImapMessage } from "@/lib/mail/imap";
import { requireSessionOr401 } from "@/lib/auth";

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const payload = (await request.json()) as { accountId: string; messageId: string };
  if (!payload?.accountId || !payload?.messageId) {
    return NextResponse.json({ ok: false, message: "Missing accountId/messageId" }, { status: 400 });
  }

  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === payload.accountId);
  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }

  const existing = await getMessageById(payload.accountId, payload.messageId);
  const mailboxPath = existing?.mailboxPath;
  const imapUid = typeof existing?.imapUid === "number" ? existing.imapUid : undefined;
  if (!mailboxPath || typeof imapUid !== "number" || Number.isNaN(imapUid)) {
    return NextResponse.json(
      { ok: false, message: "Message does not have IMAP metadata to re-sync." },
      { status: 400 }
    );
  }

  const message = await syncImapMessage(account, mailboxPath, imapUid);
  if (!message) {
    return NextResponse.json({ ok: false, message: "Message not found on server." }, { status: 404 });
  }

  const buildAttachmentUrl = (accountId: string, messageId: string, attachmentId: string) =>
    `/api/attachment?accountId=${encodeURIComponent(accountId)}&messageId=${encodeURIComponent(
      messageId
    )}&attachmentId=${encodeURIComponent(attachmentId)}`;
  const parseDataUrl = (dataUrl: string) => {
    const prefix = "data:";
    if (!dataUrl.startsWith(prefix)) return null;
    const commaIndex = dataUrl.indexOf(",");
    if (commaIndex === -1) return null;
    const header = dataUrl.slice(prefix.length, commaIndex);
    if (!header.includes(";base64")) return null;
    const contentType = header.split(";")[0] || "application/octet-stream";
    const payload = dataUrl.slice(commaIndex + 1);
    const buffer = Buffer.from(payload, "base64");
    return { contentType, buffer };
  };
  const sanitizeMessage = async (nextMessage: typeof message, accountId: string) => {
    if (nextMessage.source) {
      await saveMessageSource(accountId, nextMessage.id, nextMessage.source);
    }
    let htmlBody = nextMessage.htmlBody;
    const dataUrlReplacements = new Map<string, string>();
    const attachments = await Promise.all(
      (nextMessage.attachments ?? []).map(async (attachment) => {
        if (attachment.dataUrl) {
          const parsed = parseDataUrl(attachment.dataUrl);
          if (parsed) {
            await saveAttachmentData(accountId, nextMessage.id, attachment.id, parsed.buffer);
          }
        }
        const url = buildAttachmentUrl(accountId, nextMessage.id, attachment.id);
        if (attachment.dataUrl) {
          dataUrlReplacements.set(attachment.dataUrl, url);
        }
        if (attachment.inline && attachment.cid && htmlBody) {
          const cid = attachment.cid.replace(/[<>]/g, "");
          htmlBody = htmlBody.replaceAll(`cid:${cid}`, url).replaceAll(`cid:${attachment.cid}`, url);
        }
        const { dataUrl, ...rest } = attachment;
        return { ...rest, url };
      })
    );
    if (htmlBody) {
      dataUrlReplacements.forEach((url, dataUrl) => {
        htmlBody = htmlBody?.replaceAll(dataUrl, url);
      });
      htmlBody = htmlBody.replace(/data:(?!image\/)[^'")\s]+/gi, "about:blank");
    }
    const { source, ...rest } = nextMessage;
    return {
      ...rest,
      htmlBody,
      attachments,
      hasSource: Boolean(source ?? nextMessage.hasSource)
    };
  };

  const threadId = (() => {
    if (message.inReplyTo) return message.inReplyTo;
    if (message.references && message.references.length > 0) {
      return message.references[message.references.length - 1];
    }
    return message.threadId;
  })();
  const replyIds = message.inReplyTo ? [message.inReplyTo] : [];
  const externalThreadIds = replyIds.length
    ? await getThreadIdsByMessageIds(account.id, replyIds)
    : new Map<string, string>();
  const resolvedThreadId =
    (message.inReplyTo && externalThreadIds.get(message.inReplyTo)) || threadId;
  const sanitized = await sanitizeMessage(
    {
      ...message,
      threadId: resolvedThreadId ?? message.threadId
    },
    account.id
  );
  await upsertMessages(account.id, message.folderId, [sanitized], false);

  return NextResponse.json({ ok: true });
}
