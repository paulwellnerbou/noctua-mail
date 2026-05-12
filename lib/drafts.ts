import type { Account, Message } from "@/lib/data";
import type { ComposeInviteDraft } from "@/lib/composeInvite";
import { COMPOSE_INVITE_HEADER, encodeComposeInviteHeader } from "@/lib/composeInviteMetadata";
import {
  deleteMessageById,
  getAttachmentIds,
  getFolders,
  getMessageById,
  resolveThreadingForAccountMessages,
  upsertMessages
} from "./serverDb";
import { deleteMessageFiles, getMessageSource } from "@/lib/storage";
import { parseComposeAttachments, resolveComposeHtml } from "@/lib/mail/composePayload";
import { appendImapMessage, deleteImapMessage, syncImapMessage } from "./serverImap";
import { buildRawMessage, sendRawSmtpMessage } from "./serverSmtp";
import { hasMessageFlag } from "@/lib/messageFlags";
import {
  injectUndisclosedRecipientsToHeader,
  stripBccHeader
} from "@/lib/mail/stripBccHeader";
import { sanitizeSyncedMessage } from "@/lib/mail/syncMessageSanitizer";
import { folderMailboxPath } from "@/lib/mailboxPaths";
import { splitRecipientEntries } from "@/lib/recipientLists";
import { buildReplyThreadHeaders } from "@/lib/replyThreadHeaders";
import { findDraftsFolder, findSentFolder } from "@/lib/specialFolders";
import {
  buildDraftSendEnvelopeRecipients,
  draftHasSendableRecipients
} from "@/lib/draftSendEnvelope";

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
  invite?: ComposeInviteDraft;
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
  invite?: ComposeInviteDraft;
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

export class DraftSendError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DraftSendError";
    this.status = status;
  }
}

export type SendDraftResult = {
  sentFolderId: string | null;
  sentMessageUid: number | null;
  messageId: string | null;
};

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
    const replyTo = message.replyTo?.trim();
    if (replyTo) return replyTo;
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
      invite: input.invite,
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
    invite: input.invite,
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
  const existingDraft = payload.draftId ? await getMessageById(accountId, payload.draftId) : null;
  const preservedMessageId = existingDraft?.messageId?.trim() || undefined;

  const raw = await buildRawMessage(account, {
    to: payload.to,
    cc: payload.cc,
    bcc: payload.bcc,
    keepBcc: true,
    subject: payload.subject,
    text: payload.text,
    html,
    messageId: preservedMessageId,
    inReplyTo: payload.inReplyTo,
    references: payload.references,
    xForwardedMessageId: payload.xForwardedMessageId,
    headers: payload.invite
      ? { [COMPOSE_INVITE_HEADER]: encodeComposeInviteHeader(payload.invite) }
      : undefined,
    ...(attachments.length > 0 ? { attachments } : {})
  });

  if (payload.draftId) {
    if (existingDraft?.imapUid && existingDraft.mailboxPath) {
      await deleteImapMessage(account, existingDraft.mailboxPath, existingDraft.imapUid, clientId);
    }
    if (existingDraft) {
      await deleteMessageById(accountId, existingDraft.id);
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
    sanitized.draftInvite = payload.invite ?? null;
    await upsertMessages(account.id, null, [sanitized], false);
    draftId = sanitized.id;
    savedMessage = sanitized;
  }

  return { draftId, message: savedMessage };
}

/**
 * Send a previously-saved draft without re-opening it in compose.
 *
 * The draft is relayed from its stored raw MIME source, which helps
 * preserve the drafted MIME structure and headers — attachments,
 * `Content-ID`s, the compose-invite header, and the original
 * `Message-ID` — as stored with the draft. The cached source in this
 * path is a UTF-8 string, so this preserves headers and structure
 * without promising byte-for-byte preservation; the `latin1` round-trip
 * inside `stripBccHeader` only matters when a caller hands us a
 * `Buffer` containing binary bytes, which isn't the case here. The
 * SMTP envelope is built from the draft's parsed `to`/`cc`/`bcc` —
 * we don't re-parse the raw blob for recipients.
 *
 * Two header-level edits happen before relay:
 *   1. `stripBccHeader` — the local draft is saved with
 *      `keepBcc: true`, but the wire copy must not carry `Bcc:` or
 *      blind-carbon addresses would leak to every To/Cc recipient.
 *   2. `injectUndisclosedRecipientsToHeader` — for BCC-only drafts
 *      (no To, no Cc), insert `To: undisclosed-recipients:;` so the
 *      wire copy has a recipient header. Mirrors the `outboundTo`
 *      fallback in `/api/accounts/[accountId]/smtp/send`.
 *
 * On success the draft is removed from both the IMAP Drafts mailbox
 * and the local message store, and a copy is appended to the Sent
 * folder (best-effort; append failures are swallowed to match the
 * compose-editor send path).
 */
export async function sendDraftForAccount(params: {
  account: Account;
  accountId: string;
  clientId: string;
  draftId: string;
}): Promise<SendDraftResult> {
  const { account, accountId, clientId, draftId } = params;
  const draft = await getMessageById(accountId, draftId);
  if (!draft) {
    throw new DraftSendError(404, "Draft not found");
  }

  // SECURITY GUARD. Without this check, any message with a cached raw
  // source and parseable recipients could be relayed via SMTP —
  // including *received* messages whose `From:` header is someone else,
  // which would let this endpoint be used as an abuse/spoofing vector.
  //
  // Only messages explicitly marked with the IMAP `\Draft` flag are
  // considered sendable here. Folder placement alone is NOT enough,
  // because an arbitrary received message can be moved into the Drafts
  // folder (either deliberately by an attacker with session access, or
  // incidentally by drag-and-drop) and its raw MIME — including a
  // spoofed `From:` header — would then be eligible for relay. The
  // `\Draft` flag is set by our own `saveDraftForAccount` when the
  // compose editor saves, and is preserved only by messages written
  // that way; no legitimate draft should be missing it.
  //
  // This does not replace SMTP-level `From:` authorization (that's the
  // SMTP server's job — it will reject an unauthorized sender address
  // at MAIL FROM time), it just keeps us from attempting relay in the
  // first place.
  const hasDraftFlag = hasMessageFlag(draft.flags, "\\Draft");
  if (!hasDraftFlag) {
    throw new DraftSendError(
      403,
      "Only messages saved as drafts can be sent via this endpoint. Open the message in compose and save it as a draft first."
    );
  }
  const folders = await getFolders(account.id);

  if (!draftHasSendableRecipients(draft)) {
    throw new DraftSendError(400, "Please add at least one recipient before sending.");
  }
  const rawSource = (await getMessageSource(accountId, draft.id)) ?? draft.source ?? null;
  if (!rawSource) {
    throw new DraftSendError(
      409,
      "Draft source is not cached locally. Open the draft in compose to send it."
    );
  }

  // Prepare the wire copy:
  //   - `stripBccHeader` removes the `Bcc:` header that's in the cached
  //     draft (saved with `keepBcc: true`). Relaying that unchanged would
  //     disclose blind-carbon addresses to every To/Cc recipient.
  //   - `injectUndisclosedRecipientsToHeader` handles the BCC-only case
  //     (no To, no Cc): after the strip, the message would have no
  //     recipient header at all — technically valid SMTP (the envelope
  //     still has `RCPT TO`) but several MUAs render it awkwardly.
  //     Inject `To: undisclosed-recipients:;` to match `/smtp/send`.
  //
  // The envelope recipients we build from the draft's parsed fields
  // still include Bcc addresses, so they receive the message — they
  // just don't appear in the message's own headers.
  const wireSource = injectUndisclosedRecipientsToHeader(stripBccHeader(rawSource));
  const envelopeRecipients = buildDraftSendEnvelopeRecipients(draft);
  await sendRawSmtpMessage(account, wireSource, {
    from: account.email,
    to: envelopeRecipients
  });

  // Append to Sent (best-effort — mirror `/api/accounts/[accountId]/smtp/send`).
  // Uses the ORIGINAL rawSource, keeping the Bcc header intact so the
  // user can still see whom they bcc'd when they look at their Sent copy.
  // (`folders` is already fetched above for the draft-status guard.)
  const sentFolder = findSentFolder(folders, account.id);
  const sentMailbox = sentFolder ? folderMailboxPath(sentFolder, account.id) : null;
  let sentMessageUid: number | null = null;
  if (sentMailbox) {
    try {
      sentMessageUid = await appendImapMessage(
        account,
        sentMailbox,
        Buffer.from(rawSource),
        ["\\Seen"],
        clientId
      );
    } catch {
      // ignore append failure; caller still sees ok:true
    }
  }

  // Everything past this point is post-send cleanup. The message has
  // already been relayed to the SMTP server; if any cleanup step
  // throws, we must NOT surface it as a send failure — the client
  // would display "Failed to send draft", prompting the user to retry
  // and send the message twice.
  //
  // Individually:
  //   - IMAP delete is non-fatal on its own already (wrapped below).
  //     Failure just means the draft re-appears on next sync.
  //   - `getAttachmentIds` can throw on DB issues.
  //   - `deleteMessageById` + `deleteMessageFiles` can fail on DB /
  //     filesystem issues.
  //
  // All of these are logged as warnings and swallowed. The endpoint
  // still returns success. Storage leak and stale draft rows in this
  // path are real but non-urgent; the alternative (user-visible
  // duplicate send) is worse. Surfacing these as a soft warning on
  // the client is a future UX polish.
  try {
    const attachmentIds = await getAttachmentIds(accountId, draft.id);
    if (draft.mailboxPath && typeof draft.imapUid === "number") {
      try {
        await deleteImapMessage(account, draft.mailboxPath, draft.imapUid, clientId);
      } catch (error) {
        console.warn("[draft-send] IMAP delete failed after send", {
          accountId,
          draftId: draft.id,
          error
        });
      }
    }
    await deleteMessageById(accountId, draft.id);
    await deleteMessageFiles(accountId, draft.id, attachmentIds);
  } catch (error) {
    console.warn("[draft-send] post-send cleanup failed", {
      accountId,
      draftId: draft.id,
      error
    });
  }

  return {
    sentFolderId: sentFolder?.id ?? null,
    sentMessageUid,
    messageId: draft.messageId ?? null
  };
}
