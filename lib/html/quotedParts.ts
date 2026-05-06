import { escapeHtml, stripConditionalComments } from "./strip";
import { extractHtmlBody } from "./extract";

// Building and disassembling the "quoted original message" block that our
// compose editor appends to replies and forwards. The CSS scoping helpers
// further down are used by assembleQuotedHtml to namespace the original
// message's <style> rules so they don't bleed into our own chrome.

export type QuotedHtmlParts = {
  styles: string;
  headerHtml: string;
  bodyHtml: string;
};

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
