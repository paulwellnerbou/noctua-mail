import { splitTextWithUrls } from "../linkify";
import { escapeHtml } from "./strip";

// Auto-linkify bare URLs in text nodes of an HTML fragment, without
// double-wrapping URLs that are already inside an <a>. The tag tracking
// (stack of open tags) avoids a full DOM parse while still being
// structurally safe.

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
