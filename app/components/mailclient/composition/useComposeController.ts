import type React from "react";
import { useMemo } from "react";
import TurndownService from "turndown";
import type { Account, AccountDateFormat, Message } from "@/lib/data";
import { formatMessageDate } from "@/lib/dateFormatting";
import {
  assembleQuotedHtml,
  buildQuotedHtmlPartsFromHtml,
  buildQuotedHtmlPartsFromText,
  escapeHtml,
  extractQuotedHtmlFromDraft,
  stripStyleTags
} from "@/lib/html";
import { markdownToHtml } from "@/lib/markdownConvert";
import { hasHtmlContent } from "@/lib/ui/messageView";
import { extractEmails } from "../utils/clientHelpers";
import type { ComposeMode } from "./composeTypes";
import type { ComposeState } from "./useComposeState";

type UseComposeControllerParams = {
  compose: ComposeState;
  currentAccount: Account | null;
  defaultSignatureId: string;
  accountDateFormat: AccountDateFormat;
  stripHtml: (value: string) => string;
  normalizeHtmlDerivedText: (value: string) => string;
  setDraftSavedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setDraftSaveError: React.Dispatch<React.SetStateAction<string | null>>;
  findMessageByMessageId?: (messageId: string) => Message | undefined;
};

function getPrimaryEmail(value?: string) {
  return extractEmails(value)[0] ?? null;
}

function getDisplayRecipient(value: string) {
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

function uniqueEmails(entries: string[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueRecipients(entries: string[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const email = getPrimaryEmail(entry) || entry;
    const key = email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatQuotedBody(body: string, header: string) {
  const lines = body.split(/\r?\n/);
  const quoted = lines.map((line) => `> ${line}`.trimEnd());
  return `\n\n${header}\n${quoted.join("\n")}`;
}

function prefixSubject(prefix: string, subject: string) {
  const cleaned = subject?.trim() || "(no subject)";
  return cleaned.toLowerCase().startsWith(`${prefix.toLowerCase()}:`)
    ? cleaned
    : `${prefix}: ${cleaned}`;
}

function normalizeComposeTo(value?: string | null) {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/["<>]/g, "").toLowerCase();
  if (/undisclosed[- ]recipients?/.test(normalized)) return "";
  return raw;
}

function normalizeOutboundTableMarkup(value: string): string {
  if (!value.trim()) return value;
  try {
    const parser = new DOMParser();
    const document = parser.parseFromString(value, "text/html");
    let changed = false;
    document.querySelectorAll("table").forEach((table) => {
      table.style.borderCollapse = "collapse";
      table.style.borderSpacing = "0";
      table.setAttribute("cellspacing", "0");
      changed = true;
    });
    document.querySelectorAll("td > p, th > p").forEach((paragraph) => {
      if (paragraph instanceof HTMLElement) {
        paragraph.style.margin = "0";
        changed = true;
      }
    });
    return changed ? document.body.innerHTML : value;
  } catch {
    return value;
  }
}

export function useComposeController({
  compose,
  currentAccount,
  defaultSignatureId,
  accountDateFormat,
  stripHtml,
  normalizeHtmlDerivedText,
  setDraftSavedAt,
  setDraftSaveError,
  findMessageByMessageId
}: UseComposeControllerParams) {
  const turndownService = useMemo(() => new TurndownService(), []);
  const {
    composeDirtyRef,
    composeSignatureRef,
    lastDraftHashRef,
    composeBaselineHashRef,
    composeEditorInitRef,
    composeLastEditedRef
  } = compose;

  const getSignatureBlocks = (body: string) => {
    const text = body.trim();
    if (!text) return { text: "", html: "" };
    return {
      text,
      html: `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`
    };
  };

  const applySignatureToCompose = (signature: { id: string; body: string } | null) => {
    const next = signature ? getSignatureBlocks(signature.body) : { text: "", html: "" };
    const previous = composeSignatureRef.current;
    if (compose.composeTab === "text") {
      compose.setComposeBody((prev) => {
        let base = prev;
        if (previous?.text && base.trimEnd().endsWith(previous.text)) {
          base = base.trimEnd().slice(0, -previous.text.length).trimEnd();
        }
        if (!signature || !next.text) {
          return base;
        }
        const glue = base ? "\n\n" : "";
        return `${base}${glue}${next.text}`;
      });
    } else if (compose.composeTab === "markdown") {
      compose.setComposeMarkdown((prev) => {
        let base = prev;
        if (previous?.text && base.trimEnd().endsWith(previous.text)) {
          base = base.trimEnd().slice(0, -previous.text.length).trimEnd();
        }
        if (!signature || !next.text) {
          return base;
        }
        const glue = base ? "\n\n" : "";
        return `${base}${glue}${next.text}`;
      });
    } else {
      compose.setComposeHtml((prev) => {
        let base = prev;
        if (previous?.html && base.trimEnd().endsWith(previous.html)) {
          base = base.trimEnd().slice(0, -previous.html.length).trimEnd();
        }
        if (!signature || !next.html) {
          return base;
        }
        return `${base}${next.html}`;
      });
      compose.setComposeHtmlText((prev) => {
        let base = prev;
        if (previous?.text && base.trimEnd().endsWith(previous.text)) {
          base = base.trimEnd().slice(0, -previous.text.length).trimEnd();
        }
        if (!signature || !next.text) {
          return base;
        }
        const glue = base ? "\n\n" : "";
        return `${base}${glue}${next.text}`;
      });
      compose.setComposeEditorReset((prev) => prev + 1);
    }
    composeDirtyRef.current = true;
    composeSignatureRef.current = signature
      ? { id: signature.id, text: next.text, html: next.html }
      : null;
  };

  const buildComposePayload = (options?: { preferText?: boolean }) => {
    const useHtml = compose.composeTab === "html" && !options?.preferText;
    const useMarkdown = compose.composeTab === "markdown" && !options?.preferText;

    if (useMarkdown) {
      const currentMd = compose.composeMarkdown.trim();
      const generatedHtml = markdownToHtml(currentMd);
      const quoted = compose.composeIncludeOriginal && !compose.composeQuotedHtmlEdited ? compose.composeQuotedHtml.trim() : "";
      let html: string | undefined = generatedHtml || quoted ? `${generatedHtml}${quoted}` : undefined;
      // Strip any embedded HTML from markdown for the text/plain part, keeping markdown syntax intact
      const textBody = currentMd.replace(/<[^>]+>/g, "").trim();
      const inlineAttachments = compose.composeAttachments.filter(
        (attachment) => attachment.inline && attachment.dataUrl && attachment.cid
      );
      if (html && inlineAttachments.length > 0) {
        inlineAttachments.forEach((attachment) => {
          if (!attachment.dataUrl || !attachment.cid) return;
          html = html?.split(attachment.dataUrl).join(`cid:${attachment.cid}`);
        });
      }
      if (html) {
        html = normalizeOutboundTableMarkup(html);
      }

      return { text: textBody, html, attachments: compose.composeAttachments, composeFormat: "markdown" };
    }

    let html: string | undefined;
    if (useHtml) {
      const baseHtml = compose.composeHtml.trim();
      const quoted = compose.composeIncludeOriginal && !compose.composeQuotedHtmlEdited ? compose.composeQuotedHtml.trim() : "";
      html = baseHtml || quoted ? `${baseHtml}${quoted}` : undefined;
      if (compose.composeStripImages && html) {
        html = html.replace(/<img[\s\S]*?>/gi, "");
      }
    }
    const inlineAttachments = compose.composeAttachments.filter(
      (attachment) => attachment.inline && attachment.dataUrl && attachment.cid
    );
    if (html && inlineAttachments.length > 0) {
      inlineAttachments.forEach((attachment) => {
        if (!attachment.dataUrl || !attachment.cid) return;
        html = html?.split(attachment.dataUrl).join(`cid:${attachment.cid}`);
      });
    }
    if (html) {
      html = normalizeOutboundTableMarkup(html);
    }
    if (useHtml) {
      let textFromHtml = "";
      if (html) {
        try {
          // Strip style tags before converting to text to avoid CSS in plain text
          const htmlWithoutStyles = stripStyleTags(html);
          textFromHtml = normalizeHtmlDerivedText(turndownService.turndown(htmlWithoutStyles));
        } catch {
          const htmlWithoutStyles = stripStyleTags(html);
          textFromHtml = normalizeHtmlDerivedText(stripHtml(htmlWithoutStyles));
        }
      }
      return { text: textFromHtml, html, attachments: compose.composeAttachments, composeFormat: "html" };
    }

    const currentBody = compose.composeTextRef.current?.value || compose.composeBody;
    let textBody = currentBody.trim();
    if (compose.composeIncludeOriginal && compose.composeQuotedText) {
      const suffix = `\n\n${compose.composeQuotedText}`;
      if (textBody.endsWith(suffix.trim())) {
        textBody = textBody.slice(0, -(suffix.trim().length));
      }
      textBody = `${textBody}${textBody ? "\n\n" : ""}${compose.composeQuotedText}`.trim();
    }
    return { text: textBody, html: undefined, attachments: compose.composeAttachments, composeFormat: "text" };
  };

  const openCompose = (mode: ComposeMode, message?: Message, asNew = false) => {
    lastDraftHashRef.current = "";
    composeBaselineHashRef.current = null;
    composeDirtyRef.current = false;
    composeEditorInitRef.current = false;
    setDraftSavedAt(null);
    setDraftSaveError(null);
    compose.setComposeEditorReset((prev) => prev + 1);
    compose.setComposeAttachments([]);
    compose.setComposeDragActive(false);
    compose.setComposeMode(mode);
    compose.setComposeOpenedAt(new Date().toLocaleString());
    compose.setComposeReplyMessage(null);
    compose.setComposeReplyHeaders(null);
    compose.setComposeSignatureId(defaultSignatureId ?? "");
    composeSignatureRef.current = null;
    if (mode === "edit" && message && !asNew) {
      compose.setComposeDraftId(message.id);
      compose.setComposeReplyHeaders({
        inReplyTo: message.inReplyTo ?? undefined,
        references: message.references,
        xForwardedMessageId: message.xForwardedMessageId
      });

      // Try to find the original message this draft is replying to
      if (findMessageByMessageId) {
        const originalMessageId = message.xForwardedMessageId || message.inReplyTo;
        if (originalMessageId) {
          const originalMessage = findMessageByMessageId(originalMessageId);
          if (originalMessage) {
            compose.setComposeReplyMessage(originalMessage);
          }
        }
      }
    } else {
      compose.setComposeDraftId(null);
    }

    // Set initial tab based on draft format if available, otherwise default to html
    const initialTab = (mode === "edit" && message?.xComposeFormat &&
                       (message.xComposeFormat === "markdown" || message.xComposeFormat === "text" || message.xComposeFormat === "html"))
      ? (message.xComposeFormat as "text" | "html" | "markdown")
      : "html";
    compose.setComposeTab(initialTab);
    composeLastEditedRef.current = initialTab;

    // Restore quotedHtmlEdited flag when editing a draft
    if (mode === "edit" && message?.quotedHtmlEdited) {
      compose.setComposeQuotedHtmlEdited(true);
    }

    if (!message) {
      compose.setComposeTo("");
      compose.setComposeCc("");
      compose.setComposeBcc("");
      compose.setComposeSubject("");
      compose.setComposeBody("");
      compose.setComposeHtml("");
      compose.setComposeHtmlText("");
      compose.setComposeMarkdown("");
      compose.setComposeQuotedHtml("");
      compose.setComposeQuotedHtmlEdited(false);
      compose.setComposeShowBcc(false);
      compose.setComposeStripImages(false);
      compose.setComposeIncludeOriginal(true);
      compose.setComposeQuoteHtml(true);
      compose.setComposeQuotedText("");
      compose.setComposeQuotedParts(null);
      compose.setComposeView("inline");
      compose.setComposeOpen(true);
      return;
    }

    const accountEmail = currentAccount?.email ?? "";
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
    const formattedMessageDate = formatMessageDate(
      message.dateValue,
      message.date,
      accountDateFormat
    );

    if (mode === "reply") {
      compose.setComposeReplyMessage(message);
      compose.setComposeReplyHeaders({
        inReplyTo: replyMessageId,
        references: replyReferences
      });
      const stripImages = false;
      compose.setComposeStripImages(stripImages);
      compose.setComposeIncludeOriginal(true);
      compose.setComposeQuoteHtml(true);

      if (isSentByCurrentUser) {
        const firstToRecipient = message.to ? getDisplayRecipient(message.to.split(",")[0].trim()) : "";
        const firstCcRecipient = message.cc ? getDisplayRecipient(message.cc.split(",")[0].trim()) : "";
        const firstBccRecipient = message.bcc ? getDisplayRecipient(message.bcc.split(",")[0].trim()) : "";
        const replyTo = firstToRecipient || firstCcRecipient || firstBccRecipient || "";
        compose.setComposeTo(replyTo);
      } else {
        compose.setComposeTo(fromRecipient ? fromRecipient : uniqueEmails(fromEmails).join(", "));
      }

      compose.setComposeCc("");
      compose.setComposeBcc("");
      compose.setComposeSubject(prefixSubject("Re", message.subject));
      const replyHeader = `On ${formattedMessageDate}, ${message.from} wrote:`;
      const hasValidHtml = prefersHtml && hasHtmlContent(message.htmlBody);
      if (hasValidHtml && message.htmlBody) {
        const replyParts = buildQuotedHtmlPartsFromHtml(message.htmlBody, replyHeader, stripImages);
        const replySource = assembleQuotedHtml(replyParts, true);
        compose.setComposeBody("");
        compose.setComposeHtml("");
        compose.setComposeHtmlText("");
        compose.setComposeQuotedHtml(replySource);
        compose.setComposeQuotedText(formatQuotedBody(message.body ?? "", replyHeader).trimStart());
        compose.setComposeQuotedParts(replyParts);
        compose.setComposeTab("html");
        composeLastEditedRef.current = "html";
      } else {
        const replyParts = buildQuotedHtmlPartsFromText(message.body ?? "", replyHeader);
        const replySource = assembleQuotedHtml(replyParts, true);
        compose.setComposeBody(formatQuotedBody(message.body ?? "", replyHeader).trimStart());
        compose.setComposeHtml("");
        compose.setComposeHtmlText("");
        compose.setComposeQuotedHtml(replySource);
        compose.setComposeQuotedText("");
        compose.setComposeQuotedParts(replyParts);
        compose.setComposeTab("text");
        composeLastEditedRef.current = "text";
      }
    } else if (mode === "replyAll") {
      compose.setComposeReplyMessage(message);
      compose.setComposeReplyHeaders({
        inReplyTo: replyMessageId,
        references: replyReferences
      });
      const stripImages = false;
      compose.setComposeStripImages(stripImages);
      compose.setComposeIncludeOriginal(true);
      compose.setComposeQuoteHtml(true);

      let toList: string[];
      let ccList: string[];

      if (isSentByCurrentUser) {
        toList = uniqueRecipients(
          toEmails
            .map((email) => {
              const match = (message.to ?? "").split(",").find((recipient) =>
                recipient.toLowerCase().includes(email.toLowerCase())
              );
              return match ? getDisplayRecipient(match.trim()) : email;
            })
            .filter(Boolean)
        );
        ccList = uniqueEmails([...ccEmails, ...bccEmails]);
      } else {
        toList = uniqueRecipients(fromRecipient ? [fromRecipient] : fromEmails);
        ccList = uniqueEmails(
          [...toEmails, ...ccEmails, ...bccEmails].filter(
            (email) => email.toLowerCase() !== accountEmail.toLowerCase()
          )
        ).filter((email) => !toList.includes(email));
      }

      compose.setComposeTo(toList.join(", "));
      compose.setComposeCc(ccList.join(", "));
      compose.setComposeBcc("");
      compose.setComposeSubject(prefixSubject("Re", message.subject));
      const replyHeader = `On ${formattedMessageDate}, ${message.from} wrote:`;
      const hasValidHtml = prefersHtml && hasHtmlContent(message.htmlBody);
      if (hasValidHtml && message.htmlBody) {
        const replyParts = buildQuotedHtmlPartsFromHtml(message.htmlBody, replyHeader, stripImages);
        const replySource = assembleQuotedHtml(replyParts, true);
        compose.setComposeBody("");
        compose.setComposeHtml("");
        compose.setComposeHtmlText("");
        compose.setComposeQuotedHtml(replySource);
        compose.setComposeQuotedText(formatQuotedBody(message.body ?? "", replyHeader).trimStart());
        compose.setComposeQuotedParts(replyParts);
        compose.setComposeTab("html");
        composeLastEditedRef.current = "html";
      } else {
        const replyParts = buildQuotedHtmlPartsFromText(message.body ?? "", replyHeader);
        const replySource = assembleQuotedHtml(replyParts, true);
        compose.setComposeBody(formatQuotedBody(message.body ?? "", replyHeader).trimStart());
        compose.setComposeHtml("");
        compose.setComposeHtmlText("");
        compose.setComposeQuotedHtml(replySource);
        compose.setComposeQuotedText("");
        compose.setComposeQuotedParts(replyParts);
        compose.setComposeTab("text");
        composeLastEditedRef.current = "text";
      }
    } else if (mode === "forward") {
      compose.setComposeReplyMessage(message);
      compose.setComposeReplyHeaders({
        inReplyTo: replyMessageId,
        references: replyReferences,
        xForwardedMessageId: replyMessageId
      });
      const stripImages = false;
      compose.setComposeStripImages(stripImages);
      compose.setComposeIncludeOriginal(true);
      compose.setComposeQuoteHtml(true);
      compose.setComposeTo("");
      compose.setComposeCc("");
      compose.setComposeBcc("");
      compose.setComposeSubject(prefixSubject("Fwd", message.subject));
      const forwardHeader = `Forwarded message from ${message.from} on ${formattedMessageDate}:`;
      const hasValidHtml = prefersHtml && hasHtmlContent(message.htmlBody);
      if (hasValidHtml && message.htmlBody) {
        const forwardParts = buildQuotedHtmlPartsFromHtml(message.htmlBody, forwardHeader, stripImages);
        const forwardSource = assembleQuotedHtml(forwardParts, true);
        compose.setComposeBody("");
        compose.setComposeHtml("");
        compose.setComposeHtmlText("");
        compose.setComposeQuotedHtml(forwardSource);
        compose.setComposeQuotedText(formatQuotedBody(message.body ?? "", forwardHeader).trimStart());
        compose.setComposeQuotedParts(forwardParts);
        compose.setComposeTab("html");
        composeLastEditedRef.current = "html";
      } else {
        const forwardParts = buildQuotedHtmlPartsFromText(message.body ?? "", forwardHeader);
        const forwardSource = assembleQuotedHtml(forwardParts, true);
        compose.setComposeBody(formatQuotedBody(message.body ?? "", forwardHeader).trimStart());
        compose.setComposeHtml("");
        compose.setComposeHtmlText("");
        compose.setComposeQuotedHtml(forwardSource);
        compose.setComposeQuotedText("");
        compose.setComposeQuotedParts(forwardParts);
        compose.setComposeTab("text");
        composeLastEditedRef.current = "text";
      }
    } else {
      if (mode === "editAsNew") {
        compose.setComposeReplyHeaders({
          inReplyTo: replyMessageId,
          references: replyReferences
        });
      }
      compose.setComposeStripImages(false);
      compose.setComposeIncludeOriginal(true);
      compose.setComposeQuoteHtml(true);
      compose.setComposeTo(normalizeComposeTo(message.to ?? ""));
      compose.setComposeCc(message.cc ?? "");
      compose.setComposeBcc(message.bcc ?? "");
      compose.setComposeShowBcc(Boolean(message.cc || message.bcc));
      compose.setComposeSubject(message.subject ?? "");
      compose.setComposeBody(normalizeHtmlDerivedText(message.body ?? ""));
      const rawHtml = message.htmlBody ?? "";
      const nextHtml = typeof rawHtml === "string" && rawHtml.trim() === "0" ? "" : rawHtml;
      const hasDraftHtml = hasHtmlContent(nextHtml);

      // If this draft has quoted HTML that wasn't edited, extract it back out
      if (mode === "edit" && !message.quotedHtmlEdited && nextHtml) {
        const { userHtml, quotedHtml } = extractQuotedHtmlFromDraft(nextHtml);
        compose.setComposeHtml(userHtml);
        compose.setComposeHtmlText(stripHtml(userHtml));
        compose.setComposeQuotedHtml(quotedHtml);
        compose.setComposeQuotedText(stripHtml(quotedHtml));
        // Note: We don't restore composeQuotedParts as it's only used during initial composition
        compose.setComposeQuotedParts(null);
      } else {
        // Draft was edited or has no quoted HTML
        compose.setComposeHtml(nextHtml);
        compose.setComposeHtmlText(stripHtml(nextHtml));
        compose.setComposeQuotedHtml("");
        compose.setComposeQuotedText("");
        compose.setComposeQuotedParts(null);
      }
      const nextTab: "text" | "html" = hasDraftHtml ? "html" : "text";
      compose.setComposeTab(nextTab);
      composeLastEditedRef.current = nextTab;
      if (!asNew) {
        const initialHash = JSON.stringify({
          to: message.to ?? "",
          cc: message.cc ?? "",
          bcc: message.bcc ?? "",
          subject: message.subject ?? "",
          text: message.body ?? "",
          html: nextHtml ?? ""
        });
        lastDraftHashRef.current = initialHash;
        setDraftSavedAt(message.dateValue ?? Date.now());
      }
    }
    if (asNew) {
      compose.setComposeDraftId(null);
    }
    compose.setComposeView("inline");
    compose.setComposeOpen(true);
  };

  const popOutCompose = () => {
    compose.setComposeView("modal");
  };

  const popInCompose = () => {
    compose.setComposeView("inline");
  };

  const minimizeCompose = () => {
    compose.setComposeView("minimized");
  };

  return {
    applySignatureToCompose,
    buildComposePayload,
    openCompose,
    popOutCompose,
    popInCompose,
    minimizeCompose
  };
}
