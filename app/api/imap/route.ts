import { NextResponse } from "next/server";
import { getAccounts, getFolders, saveFolders, upsertMessages } from "@/lib/db";
import { saveAttachmentData, saveMessageSource } from "@/lib/storage";
import { syncImapAccount } from "@/lib/mail/imap";
import { requireSessionOr401 } from "@/lib/auth";

export async function POST(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const clientId = request.headers.get("x-noctua-client") ?? undefined;
  const payload = (await request.json()) as { accountId: string; folderId?: string };
  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === payload.accountId);

  if (!account) {
    return NextResponse.json({ ok: false, message: "Account not found" }, { status: 404 });
  }

  const mailboxPath = payload.folderId
    ? payload.folderId.replace(`${account.id}:`, "")
    : undefined;
  const { messages, folders } = await syncImapAccount(
    account,
    mailboxPath,
    payload.folderId ? "full" : "recent",
    clientId
  );
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
  const sanitizeMessage = async (message: typeof messages[number], accountId: string) => {
    if (message.source) {
      await saveMessageSource(accountId, message.id, message.source);
    }
    let htmlBody = message.htmlBody;
    const dataUrlReplacements = new Map<string, string>();
    const attachments = await Promise.all(
      (message.attachments ?? []).map(async (attachment) => {
        if (attachment.dataUrl) {
          const parsed = parseDataUrl(attachment.dataUrl);
          if (parsed) {
            await saveAttachmentData(accountId, message.id, attachment.id, parsed.buffer);
          }
        }
        const url = buildAttachmentUrl(accountId, message.id, attachment.id);
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
    const { source, ...rest } = message;
    return {
      ...rest,
      htmlBody,
      attachments,
      hasSource: Boolean(source ?? message.hasSource)
    };
  };
  const strippedMessages = await Promise.all(messages.map((message) => sanitizeMessage(message, account.id)));
  await upsertMessages(account.id, payload.folderId ?? null, strippedMessages);

  const existing = await getFolders();
  const nextFolders = [...existing.filter((folder) => folder.accountId !== account.id), ...folders];
  await saveFolders(nextFolders);

  return NextResponse.json({ ok: true, count: messages.length });
}
