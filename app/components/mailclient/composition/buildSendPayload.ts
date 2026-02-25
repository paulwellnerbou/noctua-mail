import type { Attachment, Message } from "@/lib/data";
import { shouldThreadComposeForMode } from "./composeThreading";
import type { ComposeMode, ComposeReplyHeaders } from "./composeTypes";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SendPayloadInput = {
  composeTo: string;
  composeCc: string;
  composeBcc: string;
  composeSubject: string;
  text: string;
  html: string | undefined;
  attachments: Attachment[];
  composeReplyHeaders: ComposeReplyHeaders | null;
  composeReplyMessage: Message | null;
  /** Result of `getAccountFromValue(currentAccount)` — "Name <email>" or just "email". */
  accountFromValue: string;
};

export type SmtpPayload = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  text: string;
  html: string | undefined;
  attachments: Attachment[];
  inReplyTo: string | undefined;
  references: string[] | undefined;
  /** Empty string means omit the Reply-To header. */
  replyTo: string;
  xForwardedMessageId: string | undefined;
};

// ---------------------------------------------------------------------------
// Pure function
// ---------------------------------------------------------------------------

export function buildSendPayload(mode: ComposeMode, input: SendPayloadInput): SmtpPayload {
  const {
    composeTo,
    composeCc,
    composeBcc,
    composeSubject,
    text,
    html,
    attachments,
    composeReplyHeaders,
    composeReplyMessage,
    accountFromValue
  } = input;

  // Fall back to headers derived from the reply message when no explicit
  // reply headers were stored (e.g. the compose was opened without a draft).
  const replyHeaders: ComposeReplyHeaders = composeReplyHeaders ?? {
    inReplyTo: composeReplyMessage?.messageId ?? undefined,
    references: composeReplyMessage?.messageId
      ? [
          ...(composeReplyMessage.references ?? []),
          ...(composeReplyMessage.inReplyTo ? [composeReplyMessage.inReplyTo] : []),
          composeReplyMessage.messageId
        ]
      : undefined,
    xForwardedMessageId: composeReplyMessage?.messageId ?? undefined
  };

  const shouldThread = shouldThreadComposeForMode(mode);

  // Reply-To: only set for reply/replyAll, and only when it differs from From.
  const replyToHeader = mode === "reply" || mode === "replyAll" ? accountFromValue : "";
  const normalizedReplyTo =
    replyToHeader &&
    accountFromValue &&
    replyToHeader.trim().toLowerCase() === accountFromValue.trim().toLowerCase()
      ? ""
      : replyToHeader;

  return {
    to: composeTo,
    cc: composeCc,
    bcc: composeBcc,
    subject: composeSubject,
    text,
    html,
    attachments,
    inReplyTo: shouldThread ? replyHeaders.inReplyTo : undefined,
    references: shouldThread ? replyHeaders.references : undefined,
    replyTo: normalizedReplyTo,
    xForwardedMessageId: mode === "forward" ? replyHeaders.xForwardedMessageId : undefined
  };
}
