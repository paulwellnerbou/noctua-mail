import { NextResponse } from "next/server";
import { getAttachmentData } from "@/lib/storage";
import { getAttachmentMeta } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const messageId = searchParams.get("messageId");
  const attachmentId = searchParams.get("attachmentId");

  if (!accountId || !messageId || !attachmentId) {
    return NextResponse.json({ ok: false, message: "Missing parameters" }, { status: 400 });
  }

  const attachment = await getAttachmentMeta(messageId, attachmentId);
  if (!attachment) {
    return NextResponse.json({ ok: false, message: "Attachment not found" }, { status: 404 });
  }

  const data = await getAttachmentData(accountId, messageId, attachmentId);
  if (!data) {
    return NextResponse.json({ ok: false, message: "Attachment data not found" }, { status: 404 });
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
