import { marked } from "marked";
import TurndownService from "turndown";

/*
 * Text-format conversion map (source → destination)
 * ==================================================
 *
 * This module is the canonical home for programmatic markdown ↔ html ↔ text
 * conversions invoked at compose time and when rendering outbound mail. The
 * table below enumerates every conversion path in the codebase so callers
 * can pick the right helper instead of reinventing one.
 *
 * | Direction      | Purpose                                   | Helper                                         |
 * |----------------|-------------------------------------------|------------------------------------------------|
 * | md → html      | Compose tab switch (markdown → html tab)  | `markdownToHtml` (this file; uses `marked`)    |
 * | md → html      | Outbound email body (styled for clients)  | `markdownToEmailHtml` (lib/markdownEmail.ts)   |
 * | md → DOM       | Rendered message view                     | `<ReactMarkdown>` (MarkdownPanel.tsx)          |
 * | md → editor    | Compose markdown editor UI                | `@uiw/react-md-editor` (ComposeMarkdownEditor) |
 * | html → md      | Compose tab switch (html → markdown tab)  | `htmlToMarkdown` (this file; uses `turndown`)  |
 * | html → md-ish  | Outbound text/plain fallback from HTML    | `htmlToMarkdown` (reused by composeContentBuilder) |
 * | html → text    | Compose strip (quoted-parts, tab switch)  | `stripHtmlToText` (lib/html.ts; regex-based)   |
 * | html → text    | Inbound IMAP preview / QP fallback        | `html-to-text` via `convert()` (lib/mail/imap.ts) |
 * | html → html    | Display sanitization                      | `sanitizeHtmlForDisplay` (lib/html.ts)         |
 * | text → md      | Compose tab switch (text → markdown tab)  | `textToMarkdown` (this file; pass-through)     |
 * | text → html    | Compose tab switch (text → html tab)      | inline `<p>…</p>` in composeTabSwitch.ts       |
 *
 * Why two `html → text` paths?
 *   `stripHtmlToText` is a zero-dep regex stripper used client-side for
 *   compose tab switches and quoted-parts extraction. `html-to-text` is a
 *   styling-aware converter used server-side during IMAP parsing (skip img,
 *   ignore href). Different use cases, legitimately separate libraries.
 *
 * Why two `md → html` paths?
 *   `markdownToHtml` (marked) is used for the compose tab switch where we
 *   need synchronous conversion. `markdownToEmailHtml` wraps it and inlines
 *   `@uiw/react-markdown-preview` CSS so outbound mail renders consistently
 *   in external clients. (Note: the display path uses `react-markdown`, a
 *   third parser — a known inconsistency filed as a follow-up.)
 */

// Configure marked for email-safe HTML with GFM and line breaks
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Convert markdown source to plain HTML using marked.
 * Useful for lightweight conversions without preview styling.
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) return "";
  return marked.parse(markdown) as string;
}

/**
 * Convert HTML to markdown using Turndown.
 * Configured for clean, readable markdown output.
 */
export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return "";
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  return td.turndown(html);
}

/**
 * Convert plain text to markdown.
 * Plain text is valid markdown, so this is essentially a pass-through.
 */
export function textToMarkdown(text: string): string {
  return text;
}
