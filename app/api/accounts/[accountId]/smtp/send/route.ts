import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getFolders, upsertCalendarEvent } from "@/lib/db";
import type { ComposeInvitePayload } from "@/lib/composeInvite";
import { appendImapMessage } from "@/lib/mail/imap";
import { parseComposeAttachments, resolveComposeHtml } from "@/lib/mail/composePayload";
import { buildSentInvite } from "@/lib/mail/sentInvite";
import { sendSmtpMessage } from "@/lib/mail/smtp";
import { folderMailboxPath } from "@/lib/mailboxPaths";
import { findSentFolder } from "@/lib/specialFolders";
import {
  getAccountIdFromParams,
  requireAccountContext,
  type AccountRouteParams
} from "@/app/api/_helpers/accountContext";
import { toFiniteNumber } from "@/app/api/_helpers/numberParsing";

function buildMessageId(address: string) {
  const domain = address.split("@")[1]?.trim();
  const safeDomain = domain && domain.length > 0 ? domain : "noctua.local";
  return `<${randomUUID()}@${safeDomain}>`;
}

export async function POST(request: Request, { params }: AccountRouteParams) {
  const payload = (await request.json()) as {
    accountId?: string;
    to?: string;
    cc?: string;
    bcc?: string;
    subject: string;
    text: string;
    markdown?: string;
    html?: string;
    composeFormat?: string;
    invite?: ComposeInvitePayload;
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
  const accountId = await getAccountIdFromParams(params);
  const accountContext = await requireAccountContext(request, accountId, {
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
  if (payload.invite && !to && !cc) {
    return NextResponse.json(
      { ok: false, message: "Event invitations require at least one To or Cc recipient." },
      { status: 400 }
    );
  }
  if (payload.invite) {
    const startAtMs = toFiniteNumber(payload.invite.startAtMs);
    if (!Number.isFinite(startAtMs)) {
      return NextResponse.json(
        { ok: false, message: "Invalid invite: startAtMs must be a valid number." },
        { status: 400 }
      );
    }
    if (payload.invite.endAtMs !== undefined) {
      const endAtMs = toFiniteNumber(payload.invite.endAtMs);
      if (!Number.isFinite(endAtMs) || endAtMs < startAtMs) {
        return NextResponse.json(
          { ok: false, message: "Invalid invite: endAtMs must be a valid time not before startAtMs." },
          { status: 400 }
        );
      }
    }
    if (typeof payload.invite.location !== "undefined" && typeof payload.invite.location !== "string") {
      return NextResponse.json(
        { ok: false, message: "Invalid invite: location must be a string." },
        { status: 400 }
      );
    }
    if (typeof payload.invite.recurrenceRule !== "undefined" && typeof payload.invite.recurrenceRule !== "string") {
      return NextResponse.json(
        { ok: false, message: "Invalid invite: recurrenceRule must be a string." },
        { status: 400 }
      );
    }
  }

  const attachments = parseComposeAttachments(payload.attachments);
  const html = await resolveComposeHtml({
    composeFormat: payload.composeFormat,
    markdown: payload.markdown,
    html: payload.html,
    attachments: payload.attachments
  });

  const inviteResult = payload.invite
    ? buildSentInvite({
        account,
        invite: payload.invite,
        subject: payload.subject,
        to,
        cc,
        descriptionText: payload.text ?? ""
      })
    : null;
  if (inviteResult) {
    attachments.push({
      filename: inviteResult.filename,
      contentType: "text/calendar; method=REQUEST; charset=UTF-8",
      content: Buffer.from(inviteResult.ics, "utf8")
    });
  }

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
  let appendedUid: number | null = null;
  if (sentMailbox) {
    try {
      appendedUid = await appendImapMessage(account, sentMailbox, result.raw, ["\\Seen"], clientId);
    } catch {
      // ignore append failures
    }
  }

  let inviteScheduled = false;
  let inviteEventId: string | null = null;
  let inviteWarning: string | null = null;
  if (inviteResult) {
    try {
      await upsertCalendarEvent(account.id, inviteResult.event);
      inviteScheduled = true;
      inviteEventId = inviteResult.event.id;
    } catch (error) {
      console.error("[smtp] failed to persist sent invite event", {
        accountId: account.id,
        error
      });
      inviteWarning = "The invitation email was sent, but the local calendar event could not be scheduled.";
    }
  }

  return NextResponse.json({
    ok: true,
    sentFolderId: sentFolder?.id ?? null,
    sentMessageUid: appendedUid,
    messageId,
    inviteScheduled,
    inviteEventId,
    inviteWarning
  });
}
