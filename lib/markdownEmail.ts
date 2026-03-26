import { readFileSync } from "fs";
import { join } from "path";
import { markdownToHtml } from "./markdownConvert";

const MARKDOWN_PREVIEW_CSS_PATH = join(
  process.cwd(),
  "node_modules",
  "@uiw",
  "react-markdown-preview",
  "dist",
  "markdown.min.css"
);

let markdownPreviewCss: string | null = null;

function getMarkdownPreviewCss() {
  if (markdownPreviewCss !== null) return markdownPreviewCss;
  markdownPreviewCss = readFileSync(MARKDOWN_PREVIEW_CSS_PATH, "utf8");
  return markdownPreviewCss;
}

function renderMarkdownPreviewHtml(markdown: string) {
  const html = markdownToHtml(markdown);
  return `<div class="wmde-markdown wmde-markdown-color" data-color-mode="light">${html}</div>`;
}

/**
 * Convert markdown source to HTML that matches compose markdown preview output.
 * This is server-side only and inlines preview package CSS for email clients.
 */
export async function markdownToEmailHtml(markdown: string): Promise<string> {
  if (!markdown.trim()) return "";
  const previewHtml = renderMarkdownPreviewHtml(markdown);
  const css = getMarkdownPreviewCss();
  return `<style data-noctua-markdown-preview="true">${css}</style>${previewHtml}`;
}
