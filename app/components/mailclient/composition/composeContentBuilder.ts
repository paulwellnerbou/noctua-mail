import type { Attachment } from "@/lib/data";
import { assembleQuotedHtml, stripStyleTags } from "@/lib/html";
import type { QuotedHtmlParts } from "@/lib/html";
import { htmlToMarkdown } from "@/lib/markdownConvert";
import type { ComposeTab } from "./composeTypes";

export type ComposeContentState = {
  composeTab: ComposeTab;
  /** Current text body value. Caller must resolve the textarea ref before passing this.
   *  For text mode, this already contains the quoted text (appended at open time). */
  composeBody: string;
  composeHtml: string;
  composeMarkdown: string;
  composeQuotedHtml: string;
  composeQuotedHtmlEdited: boolean;
  /** Only applies to html and markdown modes. */
  composeIncludeOriginal: boolean;
  composeStripImages: boolean;
  composeAttachments: Attachment[];
  /** When provided, the payload's quoted HTML is assembled from parts at build
   *  time, so toggling composeQuoteHtml doesn't have to rewrite composeQuotedHtml. */
  composeQuotedParts?: QuotedHtmlParts | null;
  composeQuoteHtml?: boolean;
};

export type ComposePayload = {
  text: string;
  html: string | undefined;
  markdown: string | undefined;
  attachments: Attachment[];
  composeFormat: "text" | "html" | "markdown";
};

/** Formats a plain-text message body as a quoted block with a header line. */
export function formatQuotedBody(body: string, header: string): string {
  const lines = body.split(/\r?\n/);
  const quoted = lines.map((line) => `> ${line}`.trimEnd());
  return `\n\n${header}\n${quoted.join("\n")}`;
}

/**
 * Returns the initial textarea value for a text-mode reply or forward.
 * The leading newlines leave room for the user to type above the quoted block.
 */
export function buildTextReplyBody(originalBody: string, replyHeader: string): string {
  return formatQuotedBody(originalBody, replyHeader).trimStart();
}

export function normalizeOutboundTableMarkup(value: string): string {
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

export function buildComposePayload(
  state: ComposeContentState,
  deps: {
    stripHtml: (value: string) => string;
    normalizeHtmlDerivedText: (value: string) => string;
  },
  options?: { preferText?: boolean }
): ComposePayload {
  const { stripHtml, normalizeHtmlDerivedText } = deps;
  const useHtml = state.composeTab === "html" && !options?.preferText;
  const useMarkdown = state.composeTab === "markdown" && !options?.preferText;

  const effectiveQuotedHtml =
    state.composeQuotedParts && !state.composeQuotedHtmlEdited
      ? assembleQuotedHtml(state.composeQuotedParts, state.composeQuoteHtml ?? true)
      : state.composeQuotedHtml;

  if (useMarkdown) {
    const currentMd = state.composeMarkdown.trim();
    const quoted =
      state.composeIncludeOriginal && !state.composeQuotedHtmlEdited
        ? effectiveQuotedHtml.trim()
        : "";
    let html: string | undefined = quoted || undefined;
    // Strip any embedded HTML from markdown for the text/plain part, keeping markdown syntax intact
    const textBody = currentMd.replace(/<[^>]+>/g, "").trim();
    if (html) {
      html = normalizeOutboundTableMarkup(html);
    }
    return {
      text: textBody,
      html,
      markdown: currentMd,
      attachments: state.composeAttachments,
      composeFormat: "markdown"
    };
  }

  let html: string | undefined;
  if (useHtml) {
    const baseHtml = state.composeHtml.trim();
    const quoted =
      state.composeIncludeOriginal && !state.composeQuotedHtmlEdited
        ? effectiveQuotedHtml.trim()
        : "";
    html = baseHtml || quoted ? `${baseHtml}${quoted}` : undefined;
    if (state.composeStripImages && html) {
      html = html.replace(/<img[\s\S]*?>/gi, "");
    }
  }

  const inlineAttachments = state.composeAttachments.filter(
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
      // Strip style tags before converting to text to avoid CSS in plain text
      const htmlWithoutStyles = stripStyleTags(html);
      try {
        textFromHtml = normalizeHtmlDerivedText(htmlToMarkdown(htmlWithoutStyles));
      } catch {
        textFromHtml = normalizeHtmlDerivedText(stripHtml(htmlWithoutStyles));
      }
    }
    return {
      text: textFromHtml,
      html,
      markdown: undefined,
      attachments: state.composeAttachments,
      composeFormat: "html"
    };
  }

  // Text mode: quoted text is already embedded in composeBody (appended at open time).
  return {
    text: state.composeBody.trim(),
    html: undefined,
    markdown: undefined,
    attachments: state.composeAttachments,
    composeFormat: "text"
  };
}
