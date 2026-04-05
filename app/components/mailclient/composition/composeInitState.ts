import type { AccountDateFormat, Message } from "@/lib/data";
import { createDefaultComposeInviteDraft } from "@/lib/composeInvite";
import { formatMessageDate } from "@/lib/dateFormatting";
import {
  assembleQuotedHtml,
  buildQuotedHtmlPartsFromHtml,
  extractQuotedHtmlFromDraft
} from "@/lib/html";
import { splitRecipientEntries } from "@/lib/recipientLists";
import { hasHtmlContent } from "@/lib/ui/messageView";
import { extractEmails } from "../utils/clientHelpers";
import { buildTextReplyBody } from "./composeContentBuilder";
import { computeDraftHash } from "./draftSaveUtils";
import type { ComposeMode, ComposeQuotedParts, ComposeReplyHeaders, ComposeTab } from "./composeTypes";

// ---------------------------------------------------------------------------
// Private helpers (previously scattered across useComposeController)
// ---------------------------------------------------------------------------

function getPrimaryEmail(value?: string) {
  return extractEmails(value)[0] ?? null;
}

export function getDisplayRecipient(value: string): string {
  if (!value) return "";
  const match = value.match(/(.+)<([^>]+)>/);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, "").trim();
    const email = match[2].trim();
    return name ? `${name} <${email}>` : email;
  }
  const email = getPrimaryEmail(value);
  return email || value.trim();
}

export function uniqueEmails(entries: string[]): string[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function uniqueRecipients(entries: string[]): string[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const email = getPrimaryEmail(entry) || entry;
    const key = email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function prefixSubject(prefix: string, subject: string): string {
  const cleaned = subject?.trim() || "(no subject)";
  return cleaned.toLowerCase().startsWith(`${prefix.toLowerCase()}:`)
    ? cleaned
    : `${prefix}: ${cleaned}`;
}

export function normalizeComposeTo(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/["<>]/g, "").toLowerCase();
  if (/undisclosed[- ]recipients?/.test(normalized)) return "";
  return raw;
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export type ComposeInitFields = {
  composeTo: string;
  composeCc: string;
  composeBcc: string;
  composeShowBcc: boolean;
  composeSubject: string;
  composeBody: string;
  composeIncludeInvite: boolean;
  composeInviteLocation: string;
  composeInviteStart: string;
  composeInviteEnd: string;
  composeInviteAllDay: boolean;
  composeInviteRecurrenceRule: string;
  composeHtml: string;
  composeHtmlText: string;
  composeMarkdown: string;
  composeQuotedHtml: string;
  composeQuotedHtmlEdited: boolean;
  composeQuotedParts: ComposeQuotedParts | null;
  composeReplyHeaders: ComposeReplyHeaders | null;
  composeReplyMessage: Message | null;
  composeDraftId: string | null;
  composeTab: ComposeTab;
  composeStripImages: boolean;
  composeIncludeOriginal: boolean;
  composeQuoteHtml: boolean;
  /** Seed for lastDraftHashRef — only set for edit mode, null otherwise. */
  initialDraftHash: string | null;
  /** Seed for draftSavedAt — only set for edit mode, null otherwise. */
  initialDraftSavedAt: number | null;
};

const BLANK: ComposeInitFields = {
  composeTo: "",
  composeCc: "",
  composeBcc: "",
  composeShowBcc: false,
  composeSubject: "",
  composeBody: "",
  composeIncludeInvite: false,
  composeInviteLocation: "",
  composeInviteStart: "",
  composeInviteEnd: "",
  composeInviteAllDay: false,
  composeInviteRecurrenceRule: "",
  composeHtml: "",
  composeHtmlText: "",
  composeMarkdown: "",
  composeQuotedHtml: "",
  composeQuotedHtmlEdited: false,
  composeQuotedParts: null,
  composeReplyHeaders: null,
  composeReplyMessage: null,
  composeDraftId: null,
  composeTab: "html",
  composeStripImages: false,
  composeIncludeOriginal: true,
  composeQuoteHtml: true,
  initialDraftHash: null,
  initialDraftSavedAt: null
};

// ---------------------------------------------------------------------------
// Pure function
// ---------------------------------------------------------------------------

export function computeComposeInitState(
  mode: ComposeMode,
  message: Message | undefined,
  asNew: boolean,
  opts: {
    accountEmail: string;
    accountDateFormat: AccountDateFormat;
    preferredComposeTab?: ComposeTab;
    findMessageByMessageId?: (messageId: string) => Message | undefined;
  },
  deps: {
    stripHtml: (value: string) => string;
    normalizeHtmlDerivedText: (value: string) => string;
  }
): ComposeInitFields {
  if (!message) {
    return { ...BLANK };
  }

  const { stripHtml, normalizeHtmlDerivedText } = deps;
  const { accountEmail, accountDateFormat, preferredComposeTab } = opts;

  const fromEmails = extractEmails(message.from);
  const fromRecipient = getDisplayRecipient(message.from);
  const toEmails = extractEmails(message.to);
  const ccEmails = extractEmails(message.cc ?? "");
  const bccEmails = extractEmails(message.bcc ?? "");

  const isSentByCurrentUser = fromEmails.some(
    (email) => email.toLowerCase() === accountEmail.toLowerCase()
  );

  const prefersHtml = hasHtmlContent(message.htmlBody);
  const replyMessageId = message.messageId ?? undefined;
  const replyReferences = replyMessageId
    ? [
        ...(message.references ?? []),
        ...(message.inReplyTo ? [message.inReplyTo] : []),
        replyMessageId
      ]
    : undefined;

  const formattedDate = formatMessageDate(message.dateValue, message.date, accountDateFormat);

  const buildReplyContent = (header: string) => {
    const hasValidHtml = prefersHtml && hasHtmlContent(message.htmlBody);
    const wantsRichReply = preferredComposeTab !== "text";

    if (wantsRichReply && hasValidHtml && message.htmlBody) {
      const parts = buildQuotedHtmlPartsFromHtml(message.htmlBody, header, false);
      return {
        composeBody: "",
        composeQuotedHtml: assembleQuotedHtml(parts, true),
        composeQuotedParts: parts,
        composeTab: preferredComposeTab === "markdown" ? "markdown" : "html"
      } satisfies Pick<
        ComposeInitFields,
        "composeBody" | "composeQuotedHtml" | "composeQuotedParts" | "composeTab"
      >;
    }

    const textSource =
      typeof message.body === "string" && message.body.trim().length > 0
        ? message.body
        : hasValidHtml && message.htmlBody
          ? stripHtml(message.htmlBody)
          : "";

    return {
      composeBody: buildTextReplyBody(textSource, header),
      composeQuotedHtml: "",
      composeQuotedParts: null,
      composeTab: "text"
    } satisfies Pick<
      ComposeInitFields,
      "composeBody" | "composeQuotedHtml" | "composeQuotedParts" | "composeTab"
    >;
  };

  // -------------------------------------------------------------------------
  // reply
  // -------------------------------------------------------------------------
  if (mode === "reply") {
    const replyHeader = `On ${formattedDate}, ${message.from} wrote:`;

    let to: string;
    if (isSentByCurrentUser) {
      const firstTo = getDisplayRecipient(splitRecipientEntries(message.to)[0] ?? "");
      const firstCc = getDisplayRecipient(splitRecipientEntries(message.cc)[0] ?? "");
      const firstBcc = getDisplayRecipient(splitRecipientEntries(message.bcc)[0] ?? "");
      to = firstTo || firstCc || firstBcc || "";
    } else {
      to = fromRecipient || uniqueEmails(fromEmails).join(", ");
    }

    const replyContent = buildReplyContent(replyHeader);
    return {
      ...BLANK,
      composeTo: to,
      composeSubject: prefixSubject("Re", message.subject),
      ...replyContent,
      composeReplyMessage: message,
      composeReplyHeaders: { inReplyTo: replyMessageId, references: replyReferences }
    };
  }

  // -------------------------------------------------------------------------
  // replyAll
  // -------------------------------------------------------------------------
  if (mode === "replyAll") {
    const replyHeader = `On ${formattedDate}, ${message.from} wrote:`;

    let toList: string[];
    let ccList: string[];

    if (isSentByCurrentUser) {
      toList = uniqueRecipients(
        toEmails
          .map((email) => {
            const match = splitRecipientEntries(message.to)
              .find((r) => r.toLowerCase().includes(email.toLowerCase()));
            return match ? getDisplayRecipient(match.trim()) : email;
          })
          .filter(Boolean)
      );
      ccList = uniqueEmails([...ccEmails, ...bccEmails]);
    } else {
      toList = uniqueRecipients(fromRecipient ? [fromRecipient] : fromEmails);
      const toEmailSet = new Set(
        toList.map((r) => (getPrimaryEmail(r) || r).toLowerCase())
      );
      const allRecipientParts = [
        ...splitRecipientEntries(message.to),
        ...splitRecipientEntries(message.cc),
        ...splitRecipientEntries(message.bcc)
      ]
        .map((s) => s.trim())
        .filter(Boolean);
      ccList = uniqueRecipients(
        allRecipientParts
          .map((s) => getDisplayRecipient(s))
          .filter((r) => {
            const email = getPrimaryEmail(r) || r;
            return (
              email.toLowerCase() !== accountEmail.toLowerCase() &&
              !toEmailSet.has(email.toLowerCase())
            );
          })
      );
    }

    const replyContent = buildReplyContent(replyHeader);
    return {
      ...BLANK,
      composeTo: toList.join(", "),
      composeCc: ccList.join(", "),
      composeSubject: prefixSubject("Re", message.subject),
      ...replyContent,
      composeReplyMessage: message,
      composeReplyHeaders: { inReplyTo: replyMessageId, references: replyReferences }
    };
  }

  // -------------------------------------------------------------------------
  // forward
  // -------------------------------------------------------------------------
  if (mode === "forward") {
    const forwardHeader = `Forwarded message from ${message.from} on ${formattedDate}:`;
    const replyHeaders: ComposeReplyHeaders = {
      inReplyTo: replyMessageId,
      references: replyReferences,
      xForwardedMessageId: replyMessageId
    };

    const replyContent = buildReplyContent(forwardHeader);
    return {
      ...BLANK,
      composeSubject: prefixSubject("Fwd", message.subject),
      ...replyContent,
      composeReplyMessage: message,
      composeReplyHeaders: replyHeaders
    };
  }

  // -------------------------------------------------------------------------
  // edit / editAsNew
  // -------------------------------------------------------------------------
  const replyHeaders: ComposeReplyHeaders | null =
    mode === "edit" && !asNew
      ? {
          inReplyTo: message.inReplyTo ?? undefined,
          references: message.references,
          xForwardedMessageId: message.xForwardedMessageId
        }
      : mode === "editAsNew"
        ? { inReplyTo: replyMessageId, references: replyReferences }
        : null;

  let composeReplyMessage: Message | null = null;
  if (mode === "edit" && !asNew && opts.findMessageByMessageId) {
    const originalId = message.xForwardedMessageId || message.inReplyTo;
    if (originalId) {
      composeReplyMessage = opts.findMessageByMessageId(originalId) ?? null;
    }
  }

  const rawHtml = message.htmlBody ?? "";
  const nextHtml = typeof rawHtml === "string" && rawHtml.trim() === "0" ? "" : rawHtml;
  const hasDraftHtml = hasHtmlContent(nextHtml);

  const xFormat = message.xComposeFormat;
  const composeTab: ComposeTab =
    mode === "edit" && (xFormat === "markdown" || xFormat === "text" || xFormat === "html")
      ? xFormat
      : hasDraftHtml
        ? "html"
        : "text";

  let composeHtml: string;
  let composeHtmlText: string;
  let composeQuotedHtml: string;
  let composeQuotedHtmlEdited: boolean;

  if (mode === "edit" && !message.quotedHtmlEdited && nextHtml) {
    const { userHtml, quotedHtml } = extractQuotedHtmlFromDraft(nextHtml);
    composeHtml = userHtml;
    composeHtmlText = stripHtml(userHtml);
    composeQuotedHtml = quotedHtml;
    composeQuotedHtmlEdited = false;
  } else {
    composeHtml = nextHtml;
    composeHtmlText = stripHtml(nextHtml);
    composeQuotedHtml = "";
    composeQuotedHtmlEdited = message.quotedHtmlEdited ?? false;
  }

  const composeDraftId = mode === "edit" && !asNew ? message.id : null;
  const draftInvite = message.draftInvite ?? null;
  const defaultInvite = draftInvite ? null : createDefaultComposeInviteDraft();

  const initialDraftHash = !asNew
    ? computeDraftHash({
        to: message.to ?? "",
        cc: message.cc ?? "",
        bcc: message.bcc ?? "",
        subject: message.subject ?? "",
        text: message.body ?? "",
        html: nextHtml,
        attachments: message.attachments ?? []
      })
    : null;

  return {
    composeTo: normalizeComposeTo(message.to ?? ""),
    composeCc: message.cc ?? "",
    composeBcc: message.bcc ?? "",
    composeShowBcc: Boolean(message.cc || message.bcc),
    composeSubject: message.subject ?? "",
    composeBody: normalizeHtmlDerivedText(message.body ?? ""),
    composeIncludeInvite: Boolean(draftInvite),
    composeInviteLocation: draftInvite?.location ?? "",
    composeInviteStart: draftInvite?.start ?? defaultInvite?.start ?? "",
    composeInviteEnd: draftInvite?.end ?? defaultInvite?.end ?? "",
    composeInviteAllDay: draftInvite?.allDay ?? false,
    composeInviteRecurrenceRule: draftInvite?.recurrenceRule ?? "",
    composeHtml,
    composeHtmlText,
    composeMarkdown: "",
    composeQuotedHtml,
    composeQuotedHtmlEdited,
    composeQuotedParts: null,
    composeReplyHeaders: replyHeaders,
    composeReplyMessage,
    composeDraftId,
    composeTab,
    composeStripImages: false,
    composeIncludeOriginal: true,
    composeQuoteHtml: true,
    initialDraftHash,
    initialDraftSavedAt: !asNew ? (message.dateValue ?? Date.now()) : null
  };
}
