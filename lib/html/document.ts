import { escapeHtml } from "./strip";

// Display-layer heuristics: decide whether to render an email inside a
// viewer "frame" (based on whether the source already provides its own
// chrome), and make sure a document has a sensible <title>.

// A plain white or transparent background is the default canvas, not
// self-provided chrome, so it must not suppress the viewer frame. Helpdesk
// mailers (e.g. Helpscout) wrap otherwise-bare messages in
// `<body bgcolor="#ffffff">`, which would otherwise lose their spacing.
const TRIVIAL_BACKGROUNDS = new Set(["#fff", "#ffffff", "white", "transparent"]);

function isMeaningfulBackground(value: string | undefined) {
  const normalized = value
    ?.replace(/\s*!important\s*$/i, "")
    .trim()
    .toLowerCase() ?? "";
  if (!normalized) return false;
  return !TRIVIAL_BACKGROUNDS.has(normalized);
}

export function shouldShowHtmlViewerFrame(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return false;

  const headSample = trimmed
    .slice(0, 8192)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/\s+/g, " ");

  const bodyTag = /<body[^>]*>/i.exec(headSample)?.[0] ?? "";
  const bgColorAttr = /\sbgcolor\s*=\s*["']?([^"'\s>]+)/i.exec(bodyTag)?.[1];
  const bodyStyle = /style\s*=\s*["']([^"']*)["']/i.exec(bodyTag)?.[1] ?? "";
  const bgStyle = /background(?:-color)?\s*:\s*([^;"']+)/i.exec(bodyStyle)?.[1];
  if (isMeaningfulBackground(bgColorAttr) || isMeaningfulBackground(bgStyle)) {
    return false;
  }

  if (
    /<(?:table|td|div|section|article)[^>]*style=["'][^"']*(?:box-shadow\s*:|padding\s*:\s*(?:0\s+)?(?:1[2-9]|[2-9]\d)(?:px|rem|em)|margin\s*:\s*0(?:\s+auto)+)[^"']*["']/i.test(
      headSample
    )
  ) {
    return false;
  }

  if (
    /<table[^>]*\swidth=["']?(?:[4-9]\d{2}|\d{4,})["']?[^>]*>/i.test(headSample) &&
    /<(?:table|td|div)[^>]*(?:align=["']center["']|style=["'][^"']*margin\s*:\s*0(?:\s+auto)+[^"']*["'])/i.test(
      headSample
    )
  ) {
    return false;
  }

  return true;
}

export function ensureHtmlDocumentTitle(html: string, title: string) {
  const nextTitle = `<title>${escapeHtml(title)}</title>`;

  if (!/<html[\s>]/i.test(html)) {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    ${nextTitle}
  </head>
  <body>
    ${html}
  </body>
</html>`;
  }

  if (/<head[\s>]/i.test(html)) {
    if (/<title[\s>][\s\S]*?<\/title>/i.test(html)) {
      return html.replace(/<title[\s>][\s\S]*?<\/title>/i, nextTitle);
    }
    return html.replace(/<head([^>]*)>/i, `<head$1>${nextTitle}`);
  }

  return html.replace(/<html([^>]*)>/i, `<html$1><head>${nextTitle}</head>`);
}
