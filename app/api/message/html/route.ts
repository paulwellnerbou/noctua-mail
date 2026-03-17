import { NextResponse } from "next/server";
import { getMessageById } from "@/lib/db";
import { requireSessionAccountOr403, requireSessionOr401 } from "@/lib/auth";
import { formatMessagePageTitle } from "@/lib/appBranding";
import { appendMessageIdToError } from "../errorFormatting";
import {
  appendUnreferencedInlineImages,
  ensureHtmlDocumentTitle,
  escapeHtml,
  sanitizeHtmlForDisplay,
  stripConditionalComments
} from "@/lib/html";

function postprocessHtml(
  html: string,
  attachments: Array<{
    inline?: boolean;
    cid?: string;
    url?: string;
    dataUrl?: string;
    contentType?: string;
    filename?: string;
  }>
) {
  let nextHtml = html;
  attachments.forEach((attachment) => {
    if (attachment.url && attachment.dataUrl) {
      nextHtml = nextHtml.replaceAll(attachment.dataUrl, attachment.url);
    }
    if (attachment.url && attachment.inline && attachment.cid) {
      const cid = attachment.cid.replace(/[<>]/g, "");
      nextHtml = nextHtml
        .replaceAll(`cid:${cid}`, attachment.url)
        .replaceAll(`cid:${attachment.cid}`, attachment.url);
    }
  });
  nextHtml = appendUnreferencedInlineImages(nextHtml, attachments);
  return sanitizeHtmlForDisplay(stripConditionalComments(nextHtml)).replace(
    /data:(?!image\/)[^'")\s]+/gi,
    "about:blank"
  );
}

function asHtmlDocument(subject: string, html: string) {
  return ensureHtmlDocumentTitle(html, formatMessagePageTitle(subject || "Message HTML"));
}

function htmlError(status: number, message: string) {
  return new NextResponse(
    asHtmlDocument(
      "HTML Debug View",
      `<main><h1>HTML Debug View</h1><p>${escapeHtml(message)}</p></main>`
    ),
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

export async function GET(request: Request) {
  const session = requireSessionOr401(request);
  if (session instanceof NextResponse) return session;
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const messageId = searchParams.get("messageId");

  if (!accountId || !messageId) {
    return htmlError(400, "Missing accountId or messageId.");
  }
  const access = requireSessionAccountOr403(session, accountId);
  if (access instanceof NextResponse) return htmlError(403, "Forbidden.");

  const message = await getMessageById(accountId, messageId);
  if (!message) {
    return htmlError(404, appendMessageIdToError("Message not found.", messageId));
  }

  if (!message.htmlBody || !message.htmlBody.trim()) {
    return htmlError(404, "Message has no HTML body.");
  }

  const html = postprocessHtml(message.htmlBody, message.attachments ?? []);
  const payload = asHtmlDocument(message.subject ?? "", html);
  return new NextResponse(payload, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
