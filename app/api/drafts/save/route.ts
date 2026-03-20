import { NextResponse } from "next/server";
import {
  deleteMessageById,
  getFolders,
  getMessageById,
  upsertMessages
} from "@/lib/db";
import { appendImapMessage, deleteImapMessage, syncImapMessage } from "@/lib/mail/imap";
import { parseComposeAttachments, resolveComposeHtml } from "@/lib/mail/composePayload";
import { buildRawMessage } from "@/lib/mail/smtp";
import { sanitizeSyncedMessage } from "@/lib/mail/syncMessageSanitizer";
import { folderMailboxPath } from "@/lib/mailboxPaths";
import { findDraftsFolder } from "@/lib/specialFolders";
import { requireAccountContext } from "@/app/api/_helpers/accountContext";

export async function handleSaveDraftRequest(
  request: Request,
  options?: { accountId?: string | null }
) {
  const payload = (await request.json()) as {
    accountId?: string;
    draftId?: string | null;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    text: string;
    markdown?: string;
    html?: string;
    composeFormat?: string;
    quotedHtmlEdited?: boolean;
    inReplyTo?: string;
    references?: string[];
    xForwardedMessageId?: string;
    attachments?: Array<{
      filename: string;
      contentType: string;
      inline?: boolean;
      cid?: string;
      dataUrl?: string;
    }>;
  };
  const accountContext = await requireAccountContext(
    request,
    options?.accountId ?? "",
    {
      missingAccountMessage: "Missing accountId"
    }
  );
  if (accountContext instanceof NextResponse) return accountContext;
  const { account, accountId, clientId } = accountContext;
  const folders = await getFolders(account.id);
  const draftsFolder = findDraftsFolder(folders, account.id);
  if (!draftsFolder) {
    return NextResponse.json(
      { ok: false, message: "Drafts folder not found" },
      { status: 400 }
    );
  }
  const draftsMailbox = folderMailboxPath(draftsFolder, account.id);
  const attachments = parseComposeAttachments(payload.attachments);
  const html = await resolveComposeHtml({
    composeFormat: payload.composeFormat,
    markdown: payload.markdown,
    html: payload.html,
    attachments: payload.attachments
  });

  const raw = await buildRawMessage(account, {
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    keepBcc: true,
    subject: payload.subject,
    text: payload.text,
    html,
    inReplyTo: payload.inReplyTo,
    references: payload.references,
    xForwardedMessageId: payload.xForwardedMessageId,
    ...(attachments.length > 0 ? { attachments } : {})
  });

  if (payload.draftId) {
    const existing = await getMessageById(accountId, payload.draftId);
    if (existing?.imapUid && existing.mailboxPath) {
      await deleteImapMessage(account, existing.mailboxPath, existing.imapUid, clientId);
    }
    if (existing) {
      await deleteMessageById(accountId, existing.id);
    }
  }

  const uid = await appendImapMessage(account, draftsMailbox, raw, ["\\Draft", "\\Seen"], clientId);
  if (!uid) {
    return NextResponse.json(
      { ok: false, message: "Failed to save draft to IMAP server" },
      { status: 502 }
    );
  }

  let messageId: string | null = null;
  let savedMessage = null;
  const message = await syncImapMessage(account, draftsMailbox, uid, clientId);
  if (message) {
    const sanitized = await sanitizeSyncedMessage(message, account.id);
    // Add compose format and quoted HTML edited flag to the message (local DB only, not stored in IMAP)
    if (payload.composeFormat) {
      sanitized.xComposeFormat = payload.composeFormat;
    }
    if (typeof payload.quotedHtmlEdited === "boolean") {
      sanitized.quotedHtmlEdited = payload.quotedHtmlEdited;
    }
    await upsertMessages(account.id, null, [sanitized], false);
    messageId = sanitized.id;
    savedMessage = sanitized;
  }

  return NextResponse.json({ ok: true, draftId: messageId, message: savedMessage });
}

export { legacyAccountRouteRemoved as POST } from "@/app/api/_helpers/legacyAccountRouteRemoved";
