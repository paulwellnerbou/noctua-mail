import type { Account, Message } from "@/lib/data";
import {
  deleteMessageById,
  getFolders,
  getMessageById,
  resolveThreadingForAccountMessages,
  upsertMessages
} from "@/lib/db";
import { appendImapMessage, deleteImapMessage, syncImapMessage } from "@/lib/mail/imap";
import { parseComposeAttachments, resolveComposeHtml } from "@/lib/mail/composePayload";
import { buildRawMessage } from "@/lib/mail/smtp";
import { sanitizeSyncedMessage } from "@/lib/mail/syncMessageSanitizer";
import { folderMailboxPath } from "@/lib/mailboxPaths";
import { splitRecipientEntries } from "@/lib/recipientLists";
import { buildReplyThreadHeaders } from "@/lib/replyThreadHeaders";
import { findDraftsFolder } from "@/lib/specialFolders";

export type DraftAttachmentInput = {
  filename: string;
  contentType: string;
  inline?: boolean;
  cid?: string;
  dataUrl?: string;
};

export type SaveDraftInput = {
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
  attachments?: DraftAttachmentInput[];
};

export type DraftCreateMode = "new" | "reply" | "forward";

export type CreateDraftMessageInput = {
  mode?: DraftCreateMode;
  messageId?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  text?: string;
  markdown?: string;
  html?: string;
  composeFormat?: string;
  quotedHtmlEdited?: boolean;
  attachments?: DraftAttachmentInput[];
};

export type SaveDraftResult = {
  draftId: string | null;
  message: Message | null;
};

export class DraftSaveError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DraftSaveError";
    this.status = status;
  }
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function extractEmails(value?: string | null) {
  if (!value) return [];
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  return matches ?? [];
}

function prefixSubject(prefix: string, subject?: string | null) {
  const cleaned = subject?.trim() || "(no subject)";
  return cleaned.toLowerCase().startsWith(`${prefix.toLowerCase()}:`)
    ? cleaned
    : `${prefix}: ${cleaned}`;
}

function getReplyRecipient(account: Account, message: Message) {
  const accountEmail = normalizeEmail(account.email);
  const sentByCurrentUser = extractEmails(message.from).some(
    (email) => normalizeEmail(email) === accountEmail
  );
  if (!sentByCurrentUser) {
    return message.from?.trim() ?? "";
  }

  const firstOtherRecipient =
    splitRecipientEntries(message.to)[0] ??
    splitRecipientEntries(message.cc)[0] ??
    splitRecipientEntries(message.bcc)[0] ??
    "";
  return firstOtherRecipient.trim();
}

export async function buildDraftInputForMode(
  account: Account,
  accountId: string,
  input: CreateDraftMessageInput
): Promise<SaveDraftInput> {
  const mode = input.mode ?? "new";
  const referenceId = input.messageId?.trim() ?? "";
  if (mode === "new") {
    if (referenceId) {
      throw new DraftSaveError(400, 'New drafts do not accept "messageId".');
    }
    return {
      to: input.to?.trim() ?? "",
      cc: input.cc?.trim() ?? "",
      bcc: input.bcc?.trim() ?? "",
      subject: input.subject?.trim() ?? "",
      text: input.text ?? "",
      markdown: input.markdown,
      html: input.html,
      composeFormat:
        input.composeFormat ?? (input.html ? "html" : input.markdown ? "markdown" : "text"),
      quotedHtmlEdited: input.quotedHtmlEdited,
      attachments: input.attachments
    };
  }

  if (!referenceId) {
    throw new DraftSaveError(400, `"messageId" is required for ${mode} drafts.`);
  }

  const referenceMessage = await getMessageById(accountId, referenceId);
  if (!referenceMessage) {
    throw new DraftSaveError(404, "Message not found");
  }

  const { inReplyTo, references } = buildReplyThreadHeaders(referenceMessage);

  return {
    to:
      input.to?.trim() ??
      (mode === "reply" ? getReplyRecipient(account, referenceMessage) : ""),
    cc: input.cc?.trim() ?? "",
    bcc: input.bcc?.trim() ?? "",
    subject:
      input.subject?.trim() ??
      (mode === "reply"
        ? prefixSubject("Re", referenceMessage.subject)
        : prefixSubject("Fwd", referenceMessage.subject)),
    text: input.text ?? "",
    markdown: input.markdown,
    html: input.html,
    composeFormat:
      input.composeFormat ?? (input.html ? "html" : input.markdown ? "markdown" : "text"),
    quotedHtmlEdited: input.quotedHtmlEdited,
    inReplyTo,
    references,
    xForwardedMessageId: mode === "forward" ? inReplyTo : undefined,
    attachments: input.attachments
  };
}

export async function saveDraftForAccount(params: {
  account: Account;
  accountId: string;
  clientId: string;
  payload: SaveDraftInput;
}): Promise<SaveDraftResult> {
  const { account, accountId, clientId, payload } = params;
  const folders = await getFolders(account.id);
  const draftsFolder = findDraftsFolder(folders, account.id);
  if (!draftsFolder) {
    throw new DraftSaveError(400, "Drafts folder not found");
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
    throw new DraftSaveError(502, "Failed to save draft to IMAP server");
  }

  let draftId: string | null = null;
  let savedMessage: Message | null = null;
  const message = await syncImapMessage(account, draftsMailbox, uid, clientId);
  if (message) {
    const [resolvedMessage] = await resolveThreadingForAccountMessages(accountId, [message]);
    const sanitized = await sanitizeSyncedMessage(resolvedMessage ?? message, account.id);
    if (payload.composeFormat) {
      sanitized.xComposeFormat = payload.composeFormat;
    }
    if (typeof payload.quotedHtmlEdited === "boolean") {
      sanitized.quotedHtmlEdited = payload.quotedHtmlEdited;
    }
    await upsertMessages(account.id, null, [sanitized], false);
    draftId = sanitized.id;
    savedMessage = sanitized;
  }

  return { draftId, message: savedMessage };
}
