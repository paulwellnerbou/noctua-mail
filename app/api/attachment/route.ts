import { NextResponse } from "next/server";
import { simpleParser } from "mailparser";
import { getAttachmentData, getMessageSource, saveAttachmentData } from "@/lib/storage";
import { getAttachmentMeta } from "@/lib/db";
import { requireAccountAccessOr403, requireSessionOr401 } from "@/lib/auth";

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const messageId = searchParams.get("messageId");
  const attachmentId = searchParams.get("attachmentId");

  if (!accountId || !messageId || !attachmentId) {
    return NextResponse.json({ ok: false, message: "Missing parameters" }, { status: 400 });
  }
  const access = await requireAccountAccessOr403(session, accountId);
  if (access instanceof NextResponse) return access;

  const attachment = await getAttachmentMeta(accountId, messageId, attachmentId);
  if (!attachment) {
    return NextResponse.json({ ok: false, message: "Attachment not found" }, { status: 404 });
  }

  let data = await getAttachmentData(accountId, messageId, attachmentId);
  if (!data) {
    const source = await getMessageSource(accountId, messageId);
    if (!source) {
      return NextResponse.json({ ok: false, message: "Attachment data not found" }, { status: 404 });
    }

    try {
      const parsed = await simpleParser(source);
      const parsedAttachments = parsed.attachments ?? [];
      const indexMatch = attachmentId.match(/-(\d+)$/);
      const attachmentIndex = indexMatch ? Number.parseInt(indexMatch[1], 10) : -1;
      const byIndex =
        attachmentIndex >= 0 && attachmentIndex < parsedAttachments.length
          ? parsedAttachments[attachmentIndex]
          : null;
      const byMetadata =
        byIndex ??
        parsedAttachments.find(
          (item: { filename?: string; contentType?: string; content?: unknown }) =>
            item.filename === attachment.filename &&
            (item.contentType ?? "application/octet-stream") ===
              (attachment.contentType ?? "application/octet-stream")
        ) ??
        null;
      if (!byMetadata || !Buffer.isBuffer(byMetadata.content)) {
        return NextResponse.json({ ok: false, message: "Attachment data not found" }, { status: 404 });
      }

      const extractedContent = Buffer.from(byMetadata.content);
      data = extractedContent;
      await saveAttachmentData(accountId, messageId, attachmentId, extractedContent);
    } catch {
      return NextResponse.json({ ok: false, message: "Attachment data not found" }, { status: 404 });
    }
  }

  const rawName = attachment.filename ?? "attachment";
  const asciiName = rawName.replace(/[^\x20-\x7E]+/g, "_");
  const encodedName = encodeURIComponent(rawName);

  return new NextResponse(data, {
    headers: {
      "Content-Type": attachment.contentType ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodedName}`
    }
  });
}
