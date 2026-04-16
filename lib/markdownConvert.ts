import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import TurndownService from "turndown";
import { unified } from "unified";

/*
 * Text-format conversion map (source → destination)
 * ==================================================
 *
 * This module is the canonical home for programmatic markdown ↔ html ↔ text
 * conversions invoked at compose time and when rendering outbound mail. The
 * table below enumerates every conversion path in the codebase so callers
 * can pick the right helper instead of reinventing one.
 *
 * | Direction      | Purpose                                   | Helper                                              |
 * |----------------|-------------------------------------------|-----------------------------------------------------|
 * | md → html      | Compose tab switch (markdown → html tab)  | `markdownToHtml` (this file; remark/rehype pipeline)|
 * | md → html      | Outbound email body (styled for clients)  | `markdownToEmailHtml` (lib/markdownEmail.ts)        |
 * | md → DOM       | Rendered message view                     | `<ReactMarkdown>` (MarkdownPanel.tsx)               |
 * | md → editor    | Compose markdown editor UI                | `@uiw/react-md-editor` (ComposeMarkdownEditor)      |
 * | html → md      | Compose tab switch (html → markdown tab)  | `htmlToMarkdown` (this file; uses `turndown`)       |
 * | html → md-ish  | Outbound text/plain fallback from HTML    | `htmlToMarkdown` (reused by composeContentBuilder)  |
 * | html → text    | Compose strip (quoted-parts, tab switch)  | `stripHtmlToText` (@/lib/html; regex-based)         |
 * | html → text    | Inbound IMAP preview / QP fallback        | `html-to-text` via `convert()` (lib/mail/imap.ts)   |
 * | html → html    | Display sanitization                      | `sanitizeHtmlForDisplay` (@/lib/html)               |
 * | text → md      | Compose tab switch (text → markdown tab)  | `textToMarkdown` (this file; pass-through)          |
 * | text → html    | Compose tab switch (text → html tab)      | inline `<p>…</p>` in composeTabSwitch.ts            |
 *
 * Why two `html → text` paths?
 *   `stripHtmlToText` is a zero-dep regex stripper used client-side for
 *   compose tab switches and quoted-parts extraction. `html-to-text` is a
 *   styling-aware converter used server-side during IMAP parsing (skip img,
 *   ignore href). Different use cases, legitimately separate libraries.
 *
 * Why two `md → html` paths?
 *   `markdownToHtml` (this file) produces the raw HTML that the compose tab
 *   switch pastes into the editor. `markdownToEmailHtml` wraps it and inlines
 *   `@uiw/react-markdown-preview` CSS so outbound mail renders consistently
 *   in external clients. Both sit on top of the same remark/rehype pipeline
 *   configured below, which shares its core plugins (`remark-gfm` +
 *   `remark-breaks`) with the display path's `react-markdown` configuration
 *   in `MarkdownPanel.tsx` — so compose preview, sent mail, and received
 *   mail run through the same parser stack (P2-13, replacing the previous
 *   `marked`-based send path).
 *
 *   Intentional deltas from the display path:
 *     - The send path enables `rehype-raw` so authors can embed raw HTML in
 *       markdown source and have it reach the recipient as HTML.
 *       `MarkdownPanel` deliberately does not, since received-mail HTML is
 *       untrusted and the display layer prefers escaping over rendering.
 *     - `MarkdownPanel` preprocesses input via `normalizeMarkdownBody` (fixes
 *       a handful of malformed-link patterns common in scraped/forwarded
 *       mail); the send path trusts its own output and skips that step.
 */

/**
 * Shared unified processor used to render markdown on the server.
 *
 * The pipeline deliberately mirrors the configuration used by
 * {@link MarkdownPanel} (react-markdown + remark-gfm + remark-breaks) so that
 * the compose live preview, the sent-mail HTML, and the received-mail display
 * all run through the same parser stack. See `lib/markdownEmail.ts` for the
 * send-path wrapper that inlines preview CSS.
 *
 *  - `remark-gfm`   : GitHub Flavored Markdown (tables, task lists, strike,
 *                     autolinks).
 *  - `remark-breaks`: treat a single `\n` inside a paragraph as `<br>`, which
 *                     matches the old `marked({ breaks: true })` behavior and
 *                     the display path.
 *  - `rehype-raw`   : retain any raw HTML that appears in the markdown source,
 *                     matching react-markdown's default when `rehype-raw` is
 *                     supplied (which MarkdownPanel does not currently pass,
 *                     but the send path has historically allowed via marked).
 */
const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkBreaks)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeStringify);

/**
 * Convert markdown source to plain HTML using the shared remark/rehype
 * pipeline. Output is intended to match what react-markdown produces in the
 * compose preview and the received-mail display path.
 */
export function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) return "";
  return String(markdownProcessor.processSync(markdown));
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
