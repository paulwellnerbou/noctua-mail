import { NextResponse } from "next/server";
import { type AccountRouteParams, getAccountIdFromParams } from "@/app/api/_helpers/accountContext";
import { getAttachmentData, getMessageSource, saveAttachmentData } from "@/lib/storage";
import { getAttachmentMeta } from "@/lib/db";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";
import { extractAttachmentBufferFromSource } from "@/lib/mail/attachmentFromSource";
import { ensureHtmlDocumentTitle, escapeHtml } from "@/lib/html";
import { formatAttachmentPageTitle } from "@/lib/appBranding";

type Params = AccountRouteParams & {
  params: Promise<{
    id?: string;
    accountId?: string;
    messageId?: string;
    attachmentId?: string;
  }>;
};

export async function GET(request: Request, { params }: Params) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const accountId = await getAccountIdFromParams(params);
  const { messageId: messageIdParam, attachmentId: attachmentIdParam } = await params;
  const { searchParams } = new URL(request.url);
  const messageId = messageIdParam ?? "";
  const attachmentId = attachmentIdParam ?? "";

  if (!accountId || !messageId || !attachmentId) {
    return NextResponse.json({ ok: false, message: "Missing parameters" }, { status: 400 });
  }
  const access = requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return access;

  const attachment = await getAttachmentMeta(accountId, messageId, attachmentId);
  if (!attachment) {
    return NextResponse.json({ ok: false, message: "Attachment not found" }, { status: 404 });
  }

  // A directly served attachment is titled by the browser from the URL's last
  // segment — the opaque attachment id — so a preview window asks for a
  // titled shell around it instead. The data is not touched here; the frame
  // fetches it from this same route without the flag.
  if (searchParams.get("preview") === "1") {
    const frameUrl = new URL(request.url);
    frameUrl.searchParams.delete("preview");
    const body = [
      "<style>html,body{margin:0;height:100%;background:#1f1d1a}",
      "iframe{border:0;display:block;width:100%;height:100%}</style>",
      `<iframe src="${escapeHtml(frameUrl.pathname + frameUrl.search)}"></iframe>`
    ].join("");
    return new NextResponse(
      ensureHtmlDocumentTitle(body, formatAttachmentPageTitle(attachment.filename)),
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
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
  const shouldDownload = searchParams.get("download") === "1";
  const disposition = shouldDownload ? "attachment" : "inline";

  return new NextResponse(data, {
    headers: {
      "Content-Type": attachment.contentType ?? "application/octet-stream",
      "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'"
    }
  });
}
