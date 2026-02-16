import { marked } from "marked";
import TurndownService from "turndown";

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
