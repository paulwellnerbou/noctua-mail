import { splitTextWithUrls } from "../linkify";
import { escapeHtml } from "./strip";

// Auto-linkify bare URLs in text nodes of an HTML fragment, without
// double-wrapping URLs that are already inside an <a>. We track only the
// current <a>-nesting depth (rather than a full tag stack) since that's
// the only structural question we need to answer, and void tags in email
// HTML (<br>, <img>, <hr>, etc.) are commonly written without a trailing
// "/>" and would otherwise leak onto the stack.

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
  let anchorDepth = 0;

  return parts.map((part) => {
    if (!part) return "";
    if (part.startsWith("<")) {
      const tagName = parseHtmlTagName(part);
      if (tagName === "a") {
        if (isClosingHtmlTag(part)) {
          if (anchorDepth > 0) anchorDepth -= 1;
        } else if (!isSelfClosingHtmlTag(part)) {
          anchorDepth += 1;
        }
      }
      return part;
    }

    if (anchorDepth > 0) {
      return part;
    }

    return splitTextWithUrls(part)
      .map((segment) => (segment.type === "url" ? buildLinkHtml(segment.value) : segment.value))
      .join("");
  }).join("");
}
