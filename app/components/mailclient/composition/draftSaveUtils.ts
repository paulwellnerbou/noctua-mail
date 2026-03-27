import type { Attachment } from "@/lib/data";
import { hasComposeInviteDraftContent, normalizeComposeInviteDraft, type ComposeInviteDraft } from "@/lib/composeInvite";
import type { ComposePayload } from "./composeContentBuilder";
import type { ComposeReplyHeaders, DraftSavePayload } from "./composeTypes";

type DraftEnvelopeFields = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
};

type DraftHashInput = DraftEnvelopeFields & {
  text: string;
  html: string | undefined;
  attachments: Attachment[];
  invite?: ComposeInviteDraft | null;
};

type DraftPayloadInput = DraftEnvelopeFields & {
  composeQuotedHtmlEdited: boolean;
  composeReplyHeaders: ComposeReplyHeaders | null;
  invite?: ComposeInviteDraft | null;
};

function buildAttachmentHash(attachments: Attachment[]): string {
  return attachments
    .map((att) => `${att.filename}:${att.size}:${att.inline ? "1" : "0"}:${att.cid ?? ""}`)
    .join("|");
}

export function computeDraftHash(input: DraftHashInput): string {
  return JSON.stringify({
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    text: input.text,
    html: input.html ?? "",
    attachments: buildAttachmentHash(input.attachments),
    invite: normalizeComposeInviteDraft(input.invite)
  });
}

export function hasDraftContent(input: Omit<DraftHashInput, "attachments">): boolean {
  return [input.to, input.cc, input.bcc, input.subject, input.text, input.html ?? ""].some(
    (value) => value.trim().length > 0
  ) || hasComposeInviteDraftContent(input.invite);
}

export function buildDraftSavePayload(
  input: DraftPayloadInput,
  composePayload: ComposePayload,
  options?: { preserveUndefinedHtml?: boolean }
): DraftSavePayload {
  const replyHeaders = input.composeReplyHeaders;
  const html =
    options?.preserveUndefinedHtml && composePayload.html === undefined
      ? undefined
      : (composePayload.html ?? "");
  return {
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    text: composePayload.text,
    html,
    composeFormat: composePayload.composeFormat,
    quotedHtmlEdited: input.composeQuotedHtmlEdited,
    inReplyTo: replyHeaders?.inReplyTo,
    references: replyHeaders?.references,
    xForwardedMessageId: replyHeaders?.xForwardedMessageId,
    invite: normalizeComposeInviteDraft(input.invite) ?? undefined,
    attachments: composePayload.attachments
  };
}
