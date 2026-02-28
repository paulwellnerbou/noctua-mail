import { escapeHtml } from "@/lib/html";
import { htmlToMarkdown, markdownToHtml, textToMarkdown } from "@/lib/markdownConvert";
import { formatQuotedBody } from "./composeContentBuilder";
import type { ComposeTab } from "./composeTypes";

export type QuotedParts = {
  styles: string;
  headerHtml: string;
  bodyHtml: string;
};

export type TextBodyParams = {
  lastEdited: ComposeTab;
  composeHtml: string;
  composeHtmlText: string;
  composeMarkdown: string;
  composeQuotedParts: QuotedParts | null;
  composeQuotedHtml: string;
  composeIncludeOriginal: boolean;
};

/**
 * Computes the plain-text body to show when switching to the Text tab.
 *
 * When coming from HTML or Markdown mode, the quoted section (stored separately
 * in composeQuotedParts / composeQuotedHtml) is NOT shown in the text tab as a
 * read-only block. It must therefore be embedded in the text body as > -prefixed
 * quoted lines, matching the initial text-mode reply format.
 */
export function computeBodyOnSwitchToText(
  params: TextBodyParams,
  deps: { stripHtml: (html: string) => string }
): string {
  const {
    lastEdited,
    composeHtml,
    composeHtmlText,
    composeMarkdown,
    composeQuotedParts,
    composeQuotedHtml,
    composeIncludeOriginal
  } = params;
  const { stripHtml } = deps;

  const buildQuotedText = (): string => {
    if (!composeIncludeOriginal) return "";
    if (composeQuotedParts) {
      const header = stripHtml(composeQuotedParts.headerHtml);
      const body = stripHtml(composeQuotedParts.bodyHtml);
      return formatQuotedBody(body, header).trimStart();
    }
    if (composeQuotedHtml) {
      return stripHtml(composeQuotedHtml);
    }
    return "";
  };

  if (lastEdited === "html") {
    const userText = composeHtmlText || stripHtml(composeHtml);
    const quotedText = buildQuotedText();
    const parts = [userText, quotedText].filter(Boolean);
    return parts.length > 1 ? parts.join("\n\n") : (parts[0] ?? "");
  }

  if (lastEdited === "markdown") {
    const userText = composeMarkdown.replace(/<[^>]+>/g, "").trim();
    const quotedText = buildQuotedText();
    const parts = [userText, quotedText].filter(Boolean);
    return parts.length > 1 ? parts.join("\n\n") : (parts[0] ?? "");
  }

  return "";
}

/**
 * Computes the HTML and its text equivalent when switching to the HTML tab.
 * Returns null when no conversion is needed (lastEdited is already "html" —
 * the Lexical editor owns its own content and does not need to be reset).
 */
export function computeHtmlOnSwitchToHtml(
  params: {
    lastEdited: ComposeTab;
    composeBody: string;
    composeMarkdown: string;
  },
  deps: { stripHtml: (html: string) => string }
): { html: string; htmlText: string } | null {
  const { lastEdited, composeBody, composeMarkdown } = params;
  const { stripHtml } = deps;

  if (lastEdited === "text") {
    const html = composeBody
      ? `<p>${escapeHtml(composeBody).replace(/\n/g, "<br>")}</p>`
      : "";
    return { html, htmlText: stripHtml(html) };
  }

  if (lastEdited === "markdown") {
    const html = markdownToHtml(composeMarkdown);
    return { html, htmlText: stripHtml(html) };
  }

  return null;
}

/**
 * Computes the markdown to show when switching to the Markdown tab.
 * Returns null when no conversion is needed (lastEdited is already "markdown").
 */
export function computeMarkdownOnSwitchToMarkdown(params: {
  lastEdited: ComposeTab;
  composeBody: string;
  composeHtml: string;
}): string | null {
  const { lastEdited, composeBody, composeHtml } = params;

  if (lastEdited === "html") {
    return htmlToMarkdown(composeHtml);
  }

  if (lastEdited === "text") {
    return textToMarkdown(composeBody);
  }

  return null;
}
