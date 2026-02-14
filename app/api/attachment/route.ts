import { NextResponse } from "next/server";
import { getAttachmentData, getMessageSource, saveAttachmentData } from "@/lib/storage";
import { getAttachmentMeta } from "@/lib/db";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";
import { extractAttachmentBufferFromSource } from "@/lib/mail/attachmentFromSource";

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
  const access = requireSessionAccountOr403(session, accountId);
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
      const extractedContent = await extractAttachmentBufferFromSource(source, {
        id: attachmentId,
        filename: attachment.filename ?? undefined,
        contentType: attachment.contentType ?? undefined,
        cid: attachment.cid ?? undefined
      });
      if (!extractedContent) {
        return NextResponse.json({ ok: false, message: "Attachment data not found" }, { status: 404 });
      }
      const normalizedContent = Buffer.from(extractedContent);
      data = normalizedContent;
      await saveAttachmentData(accountId, messageId, attachmentId, normalizedContent);
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
