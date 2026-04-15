import DOMPurify from "isomorphic-dompurify";
import { decodeHTMLStrict } from "entities";
import { splitTextWithUrls } from "./linkify";

type QuotedHtmlParts = {
  styles: string;
  headerHtml: string;
  bodyHtml: string;
};

type InlineImageAttachment = {
  inline?: boolean;
  contentType?: string;
  filename?: string;
  cid?: string;
  url?: string;
};

export function stripConditionalComments(input: string) {
  return input
    .replace(/<!--\s*\[if([^\]]+)\]>(?!\s*<!--)([\s\S]*?)<!\s*\[endif\s*\]-->/gi, (match, condition) => {
      return String(condition).trim().startsWith("!") ? match : "";
    })
    .replace(/<!--\s*\[if[^\]]+\]>\s*<!-->/gi, "")
    .replace(/<!--\s*\[if[^\]]+\]>\s*<!--\s*-->/gi, "")
    .replace(/<!--\s*\[if[^\]]+\]>\s*<!---->/gi, "")
    .replace(/<!--\s*<!\s*\[endif\s*\]\s*-->/gi, "");
}

export function stripStyleTags(input: string) {
  return input.replace(/<style[\s\S]*?<\/style>/gi, "");
}

export function sanitizeHtmlForDisplay(input: string) {
  if (!input) return input;
  const preserveWholeDocument = /<html[\s>]/i.test(input);
  const output = DOMPurify.sanitize(input, {
    WHOLE_DOCUMENT: preserveWholeDocument,
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["iframe", "object", "embed", "form", "link", "meta", "base"],
    FORBID_ATTR: ["srcdoc", "formaction", "ping"]
  });
  return typeof output === "string" ? output : String(output);
}

export function extractVisibleHtmlText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|blockquote|pre|table|tr|li|ul|ol|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(nbsp|#160|#xa0);/gi, " ")
    .replace(/[\u00a0\u200b-\u200d\u2060\ufeff\ufffc]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitConcatenatedHtmlDocuments(input: string) {
  const trimmed = input.trim();
  const startMatch = trimmed.match(/^(?:<!doctype html>\s*)?<html[\s>]/i);
  if (!startMatch) return [input];

  const segments: string[] = [];
  let cursor = 0;
  const boundaryRe = /<\/html>\s*(?:<br\s*\/?>\s*)*(?=(?:<!doctype html>\s*)?<html[\s>])/gi;
  let boundary: RegExpExecArray | null;
  while ((boundary = boundaryRe.exec(trimmed))) {
    const end = boundary.index + boundary[0].length;
    segments.push(trimmed.slice(cursor, end));
    cursor = end;
  }

  if (segments.length === 0) return [input];
  segments.push(trimmed.slice(cursor));
  return segments.filter(Boolean);
}

function scoreHtmlDocument(html: string) {
  const visibleText = extractVisibleHtmlText(html);
  return {
    html,
    visibleTextLength: visibleText.length,
    hasMeaningfulText: /[\p{L}\p{N}]/u.test(visibleText),
    hasRenderableMedia: /<(img|table|svg|video|iframe|canvas|object|embed)\b/i.test(html),
    htmlLength: html.length
  };
}

export function selectPreferredHtmlDocument(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  const candidates = splitConcatenatedHtmlDocuments(trimmed)
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  if (candidates.length <= 1) return trimmed;

  const scored = candidates.map(scoreHtmlDocument);
  return (
    scored.find((candidate) => candidate.hasMeaningfulText)?.html ??
    scored.find((candidate) => candidate.hasRenderableMedia)?.html ??
    scored.find((candidate) => candidate.visibleTextLength > 0)?.html ??
    scored[0]?.html ??
    trimmed
  );
}

export function extractBodyContent(input: string) {
  const candidates = splitConcatenatedHtmlDocuments(input)
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const normalizedCandidates = candidates.length > 0 ? candidates : [input];

  if (normalizedCandidates.length === 1 && !/<body[\s>]/i.test(normalizedCandidates[0] ?? "")) {
    return {
      body: normalizedCandidates[0] ?? "",
      styles: (normalizedCandidates[0] ?? "").match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [],
      bodyAttrs: { className: "", style: "", id: "" }
    };
  }

  const parts = normalizedCandidates.map((candidate) => {
    const scored = scoreHtmlDocument(candidate);
    const styles = candidate.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [];
    const bodyMatch = candidate.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
    const attrs = bodyMatch?.[1] ?? "";
    const classMatch = attrs.match(/class=["']([^"']+)["']/i);
    const styleMatch = attrs.match(/style=["']([^"']+)["']/i);
    const idMatch = attrs.match(/id=["']([^"']+)["']/i);

    return {
      ...scored,
      styles,
      body: (bodyMatch?.[2] ?? candidate).replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ""),
      bodyAttrs: {
        className: classMatch?.[1] ?? "",
        style: styleMatch?.[1] ?? "",
        id: idMatch?.[1] ?? ""
      }
    };
  });

  const visibleParts = parts.filter(
    (part) => part.hasMeaningfulText || part.hasRenderableMedia || part.visibleTextLength > 0
  );
  const renderedParts = visibleParts.length > 0 ? visibleParts : parts;
  const primaryPart =
    renderedParts.find((part) => part.bodyAttrs.className || part.bodyAttrs.style || part.bodyAttrs.id) ??
    renderedParts[0];

  return {
    body: renderedParts.map((part) => part.body).join(""),
    styles: renderedParts.flatMap((part) => part.styles),
    bodyAttrs: primaryPart?.bodyAttrs ?? { className: "", style: "", id: "" }
  };
}

export function shouldShowHtmlViewerFrame(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return false;

  const headSample = trimmed
    .slice(0, 8192)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/\s+/g, " ");

  if (/<body[^>]*\sbgcolor\s*=/i.test(headSample)) return false;
  if (
    /<body[^>]*style=["'][^"']*(background(?:-color)?\s*:|box-shadow\s*:|border(?:-radius)?\s*:|padding\s*:\s*(?:0\s+)?(?:1[2-9]|[2-9]\d)(?:px|rem|em)|margin\s*:\s*0)[^"']*["']/i.test(
      headSample
    )
  ) {
    return false;
  }

  if (
    /<(?:table|td|div|section|article)[^>]*(?:\sbgcolor\s*=\s*["'][^"']+["']|style=["'][^"']*(?:background(?:-color)?\s*:|box-shadow\s*:|border(?:-radius)?\s*:|padding\s*:\s*(?:0\s+)?(?:1[2-9]|[2-9]\d)(?:px|rem|em)|margin\s*:\s*0(?:\s+auto)+)[^"']*["'])/i.test(
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

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function decodeHtmlEntities(value: string) {
  if (!value || !value.includes("&")) return value;
  return decodeHTMLStrict(value);
}

export function stripHtmlToText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
        const decodedHref = decodeHtmlEntities(String(href || "")).trim();
        const label = stripHtmlToText(String(text || "")).trim();
        if (!label) return decodedHref;
        return label === decodedHref ? label : `${label} (${decodedHref})`;
      })
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|header|footer|blockquote|pre|table|tr|h[1-6])>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
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

function buildLinkHtml(url: string) {
  const safeUrl = escapeHtml(url);
  return `<a href="${safeUrl}" target="_blank" rel="noreferrer noopener">${safeUrl}</a>`;
}

function parseHtmlTagName(tag: string) {
  const match = tag.match(/^<\s*\/?\s*([a-z][\w:-]*)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function isClosingHtmlTag(tag: string) {
  return /^<\s*\//.test(tag);
}

function isSelfClosingHtmlTag(tag: string) {
  return /\/\s*>$/.test(tag);
}

export function linkifyHtmlTextNodes(input: string) {
  if (!input.includes("http://") && !input.includes("https://")) return input;

  const parts = input.split(/(<[^>]+>)/g);
  const stack: string[] = [];

  return parts.map((part) => {
    if (!part) return "";
    if (part.startsWith("<")) {
      const tagName = parseHtmlTagName(part);
      if (tagName) {
        if (isClosingHtmlTag(part)) {
          const index = stack.lastIndexOf(tagName);
          if (index >= 0) {
            stack.splice(index, 1);
          }
        } else if (!isSelfClosingHtmlTag(part)) {
          stack.push(tagName);
        }
      }
      return part;
    }

    if (stack.includes("a")) {
      return part;
    }

    return splitTextWithUrls(part)
      .map((segment) => (segment.type === "url" ? buildLinkHtml(segment.value) : segment.value))
      .join("");
  }).join("");
}

export function extractHtmlBody(value: string) {
  const match = value.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (match?.[1]) return match[1];
  return value;
}

function splitCssSelectorList(selectors: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depthParen = 0;
  let depthBracket = 0;
  let inString: "'" | "\"" | null = null;
  for (let index = 0; index < selectors.length; index += 1) {
    const char = selectors[index];
    const previous = selectors[index - 1];
    current += char;
    if (inString) {
      if (char === inString && previous !== "\\") {
        inString = null;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      inString = char;
      continue;
    }
    if (char === "(") {
      depthParen += 1;
      continue;
    }
    if (char === ")") {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }
    if (char === "[") {
      depthBracket += 1;
      continue;
    }
    if (char === "]") {
      depthBracket = Math.max(0, depthBracket - 1);
      continue;
    }
    if (char === "," && depthParen === 0 && depthBracket === 0) {
      parts.push(current.slice(0, -1));
      current = "";
    }
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

function findCssBlockBoundary(input: string, start: number): number {
  let depthParen = 0;
  let depthBracket = 0;
  let inString: "'" | "\"" | null = null;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    const previous = input[index - 1];
    if (!inString && char === "/" && next === "*") {
      const commentEnd = input.indexOf("*/", index + 2);
      return commentEnd === -1 ? input.length : findCssBlockBoundary(input, commentEnd + 2);
    }
    if (inString) {
      if (char === inString && previous !== "\\") {
        inString = null;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      inString = char;
      continue;
    }
    if (char === "(") {
      depthParen += 1;
      continue;
    }
    if (char === ")") {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }
    if (char === "[") {
      depthBracket += 1;
      continue;
    }
    if (char === "]") {
      depthBracket = Math.max(0, depthBracket - 1);
      continue;
    }
    if (depthParen === 0 && depthBracket === 0 && (char === "{" || char === ";")) {
      return index;
    }
  }
  return input.length;
}

function findCssMatchingBrace(input: string, openingBraceIndex: number): number {
  let depth = 1;
  let inString: "'" | "\"" | null = null;
  for (let index = openingBraceIndex + 1; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    const previous = input[index - 1];
    if (!inString && char === "/" && next === "*") {
      const commentEnd = input.indexOf("*/", index + 2);
      if (commentEnd === -1) {
        return input.length - 1;
      }
      index = commentEnd + 1;
      continue;
    }
    if (inString) {
      if (char === inString && previous !== "\\") {
        inString = null;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      inString = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return input.length - 1;
}

function scopeCssSelector(selector: string, scope: string): string {
  const trimmed = selector.trim();
  if (!trimmed) return trimmed;
  const replacedRoot = trimmed
    .replace(/(^|[\s>+~])(html|body|:root)\b/gi, (_, prefix: string) => `${prefix}${scope}`)
    .replace(new RegExp(`${scope}\\s+${scope}`, "g"), scope);
  if (replacedRoot.includes(scope)) {
    return replacedRoot;
  }
  return `${scope} ${replacedRoot}`;
}

function scopeCssRules(input: string, scope: string, insideKeyframes = false): string {
  let output = "";
  let cursor = 0;
  while (cursor < input.length) {
    const boundary = findCssBlockBoundary(input, cursor);
    if (boundary >= input.length) {
      output += input.slice(cursor);
      break;
    }

    const prelude = input.slice(cursor, boundary);
    const token = input[boundary];

    if (token === ";") {
      output += `${prelude};`;
      cursor = boundary + 1;
      continue;
    }

    const closingBrace = findCssMatchingBrace(input, boundary);
    const block = input.slice(boundary + 1, closingBrace);
    const trimmedPrelude = prelude.trim();

    if (trimmedPrelude.startsWith("@")) {
      const lowerPrelude = trimmedPrelude.toLowerCase();
      const shouldRecurse =
        lowerPrelude.startsWith("@media") ||
        lowerPrelude.startsWith("@supports") ||
        lowerPrelude.startsWith("@container") ||
        lowerPrelude.startsWith("@layer") ||
        lowerPrelude.startsWith("@document") ||
        lowerPrelude.startsWith("@scope");
      const nextInsideKeyframes =
        lowerPrelude.startsWith("@keyframes") || lowerPrelude.startsWith("@-webkit-keyframes");
      const nextBlock = shouldRecurse || nextInsideKeyframes
        ? scopeCssRules(block, scope, nextInsideKeyframes)
        : block;
      output += `${prelude}{${nextBlock}}`;
      cursor = closingBrace + 1;
      continue;
    }

    const scopedPrelude = insideKeyframes
      ? prelude
      : splitCssSelectorList(prelude)
          .map((selector) => scopeCssSelector(selector, scope))
          .join(", ");
    output += `${scopedPrelude}{${scopeCssRules(block, scope, insideKeyframes)}}`;
    cursor = closingBrace + 1;
  }
  return output;
}

function scopeStyleTagCss(styleTag: string, scope: string): string {
  return styleTag.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (_, attrs, css) => {
    return `<style${attrs}>${scopeCssRules(css, scope)}</style>`;
  });
}

function isRenderableInlineImageAttachment(attachment: InlineImageAttachment) {
  if (!attachment.inline || !attachment.url) return false;
  const contentType = attachment.contentType?.toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) return false;
  // Avoid auto-injecting SVG in the fallback renderer.
  return !contentType.startsWith("image/svg+xml");
}

function normalizeInlineReferenceCandidate(value?: string | null) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/^cid:/i, "").replace(/[<>]/g, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getInlineReferenceCandidates(attachment: InlineImageAttachment) {
  return Array.from(
    new Set(
      [attachment.cid, attachment.filename]
        .map((value) => normalizeInlineReferenceCandidate(value))
        .filter(Boolean)
    )
  );
}

function buildInlineImageSnippet(attachment: InlineImageAttachment) {
  if (!isRenderableInlineImageAttachment(attachment) || !attachment.url) return null;
  const escapedUrl = escapeHtml(attachment.url);
  const alt = escapeHtml(attachment.filename?.trim() || "inline image");
  return `<div data-noctua-inline-image="1" style="margin:12px 0;"><img src="${escapedUrl}" alt="${alt}" loading="lazy" decoding="async" style="max-width:100%;height:auto;"></div>`;
}

export function replaceInlineImageSources(
  html: string,
  attachments: InlineImageAttachment[]
) {
  if (!html || attachments.length === 0) return html;

  let nextHtml = html;
  attachments.forEach((attachment) => {
    if (!attachment.inline || !attachment.url) return;
    getInlineReferenceCandidates(attachment).forEach((candidate) => {
      nextHtml = nextHtml.replace(
        new RegExp(`cid:${escapeRegExp(candidate)}(?=["')\\s>])`, "g"),
        attachment.url!
      );
    });
  });
  return nextHtml;
}

export function stripRedundantInlineImageFallbacks(
  html: string,
  attachments: InlineImageAttachment[]
) {
  if (!html || attachments.length === 0) return html;

  let nextHtml = html;
  attachments.forEach((attachment) => {
    const snippet = buildInlineImageSnippet(attachment);
    if (!snippet || !nextHtml.includes(snippet) || !attachment.url) return;
    const withoutSnippet = nextHtml.replace(snippet, "");
    if (withoutSnippet.includes(attachment.url)) {
      nextHtml = withoutSnippet;
    }
  });

  return nextHtml.replace(/<div data-noctua-inline-images="1"><\/div>/g, "");
}

export function appendUnreferencedInlineImages(
  html: string,
  attachments: InlineImageAttachment[]
) {
  if (!html || attachments.length === 0) return html;

  const snippets: string[] = [];
  attachments.forEach((attachment) => {
    const snippet = buildInlineImageSnippet(attachment);
    if (!snippet || !attachment.url) return;
    const escapedUrl = escapeHtml(attachment.url);
    if (html.includes(attachment.url) || html.includes(escapedUrl)) return;
    if (getInlineReferenceCandidates(attachment).some((candidate) => html.includes(`cid:${candidate}`))) {
      return;
    }
    snippets.push(snippet);
  });

  if (snippets.length === 0) return html;
  const block = `<div data-noctua-inline-images="1">${snippets.join("")}</div>`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${block}</body>`);
  }
  return `${html}${block}`;
}

export function buildQuotedHtmlPartsFromText(body: string, header: string): QuotedHtmlParts {
  const lines = (body ?? "").split(/\r?\n/);
  let currentDepth = 0;
  const html: string[] = [];
  const closeTo = (depth: number) => {
    while (currentDepth > depth) {
      html.push("</blockquote>");
      currentDepth--;
    }
  };
  const openTo = (depth: number) => {
    while (currentDepth < depth) {
      html.push(`<blockquote class="quote-depth-${currentDepth + 1}">`);
      currentDepth++;
    }
  };
  lines.forEach((line) => {
    const match = line.match(/^\s*(>+)\s?(.*)$/);
    const depth = match ? match[1].length : 0;
    const content = match ? match[2] : line;
    closeTo(depth);
    openTo(depth);
    const safe = escapeHtml(content || "");
    html.push(`<p>${safe === "" ? "<br>" : safe}</p>`);
  });
  closeTo(0);
  return {
    styles: "",
    headerHtml: `<p><br></p><p>${escapeHtml(header)}</p>`,
    bodyHtml: html.join("")
  };
}

export function buildQuotedHtmlPartsFromHtml(
  html: string,
  header: string,
  stripImages: boolean
): QuotedHtmlParts {
  const sanitizedHtml = stripConditionalComments(html);
  const styles = (sanitizedHtml.match(/<style[\s\S]*?<\/style>/gi) ?? []).join("\n");
  let bodyContent = extractHtmlBody(sanitizedHtml).replace(/<style[\s\S]*?<\/style>/gi, "");
  if (stripImages) {
    bodyContent = bodyContent.replace(/<img[\s\S]*?>/gi, "");
  }
  return {
    styles,
    headerHtml: `<p>${escapeHtml(header)}</p>`,
    bodyHtml: bodyContent
  };
}

export function assembleQuotedHtml(parts: QuotedHtmlParts, quoteHtml: boolean) {
  const scope = "#noctua-quoted-html .noctua-quoted-email-body";
  const scopedStyles = parts.styles ? scopeStyleTagCss(parts.styles, scope) : "";
  const emailBodyHtml = `<div class="noctua-quoted-email-body">${parts.bodyHtml}</div>`;
  const bodyHtml = quoteHtml
    ? `<blockquote type="cite" style="margin:0 0 0 .8ex;border-left:2px solid #cfcfcf;padding-left:1ex;">${emailBodyHtml}</blockquote>`
    : emailBodyHtml;
  // Wrap the entire quoted section (styles + header + body) in a div for easy extraction.
  // Scope the original message CSS to the quoted email body only so the reply header
  // stays visually outside the original message's own layout and styling.
  return `<div id="noctua-quoted-html">${scopedStyles}${parts.headerHtml}${bodyHtml}</div>`;
}

/**
 * Extracts quoted HTML from a draft's combined HTML body.
 * Returns the user's HTML and the quoted HTML separately.
 *
 * The quoted section is always appended last (`${userHtml}${quotedHtml}`), so we
 * only need to locate the opening tag — no need to find the matching closing tag,
 * which would require a full DOM parser to handle nested elements correctly.
 */
export function extractQuotedHtmlFromDraft(combinedHtml: string): {
  userHtml: string;
  quotedHtml: string;
} {
  // Match only the opening tag of the marker div, not the full element.
  const markerMatch = combinedHtml.search(/<div[^>]*\bid="noctua-quoted-html"[^>]*>/i);
  if (markerMatch === -1) {
    return { userHtml: combinedHtml, quotedHtml: "" };
  }
  return {
    userHtml: combinedHtml.slice(0, markerMatch).trim(),
    quotedHtml: combinedHtml.slice(markerMatch)
  };
}
