import { readFileSync } from "fs";
import { join } from "path";
import { createElement } from "react";

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

async function renderMarkdownPreviewHtml(markdown: string) {
  const [{ default: MarkdownPreview }, { renderToStaticMarkup }] = await Promise.all([
    import("@uiw/react-markdown-preview"),
    import("react-dom/server")
  ]);
  return renderToStaticMarkup(
    createElement(MarkdownPreview, {
      source: markdown,
      disableCopy: true,
      wrapperElement: { "data-color-mode": "light" }
    })
  );
}

/**
 * Convert markdown source to HTML that matches compose markdown preview output.
 * This is server-side only and inlines preview package CSS for email clients.
 */
export async function markdownToEmailHtml(markdown: string): Promise<string> {
  if (!markdown.trim()) return "";
  const previewHtml = await renderMarkdownPreviewHtml(markdown);
  const css = getMarkdownPreviewCss();
  return `<style data-noctua-markdown-preview="true">${css}</style>${previewHtml}`;
}
