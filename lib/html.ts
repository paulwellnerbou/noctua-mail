type QuotedHtmlParts = {
  styles: string;
  headerHtml: string;
  bodyHtml: string;
};

type InlineImageAttachment = {
  inline?: boolean;
  contentType?: string;
  filename?: string;
  url?: string;
};

export function stripConditionalComments(input: string) {
  return input.replace(/<!--\s*\[if[\s\S]*?<!\s*\[endif\s*\]\s*-->/gi, "");
}

export function stripStyleTags(input: string) {
  return input.replace(/<style[\s\S]*?<\/style>/gi, "");
}

export function sanitizeHtmlForDisplay(input: string) {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<link[\s\S]*?>/gi, "")
    .replace(/\son[a-z]+\s*=\s*["'][\s\S]*?["']/gi, "")
    .replace(/\s(href|src)\s*=\s*["']\s*javascript:[^"']*["']/gi, "");
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function extractHtmlBody(value: string) {
  const match = value.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (match?.[1]) return match[1];
  return value;
}

function isRenderableInlineImageAttachment(attachment: InlineImageAttachment) {
  if (!attachment.inline || !attachment.url) return false;
  const contentType = attachment.contentType?.toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) return false;
  // Avoid auto-injecting SVG in the fallback renderer.
  return !contentType.startsWith("image/svg+xml");
}

export function appendUnreferencedInlineImages(
  html: string,
  attachments: InlineImageAttachment[]
) {
  if (!html || attachments.length === 0) return html;

  const snippets: string[] = [];
  attachments.forEach((attachment) => {
    if (!isRenderableInlineImageAttachment(attachment) || !attachment.url) return;
    const escapedUrl = escapeHtml(attachment.url);
    if (html.includes(attachment.url) || html.includes(escapedUrl)) return;
    const alt = escapeHtml(attachment.filename?.trim() || "inline image");
    snippets.push(
      `<div data-noctua-inline-image="1" style="margin:12px 0;"><img src="${escapedUrl}" alt="${alt}" loading="lazy" decoding="async" style="max-width:100%;height:auto;"></div>`
    );
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
  let bodyContent = extractHtmlBody(sanitizedHtml);
  if (stripImages) {
    bodyContent = bodyContent.replace(/<img[\s\S]*?>/gi, "");
  }
  const styles = (sanitizedHtml.match(/<style[\s\S]*?<\/style>/gi) ?? []).join("\n");
  return {
    styles,
    headerHtml: `<p>${escapeHtml(header)}</p>`,
    bodyHtml: bodyContent
  };
}

export function assembleQuotedHtml(parts: QuotedHtmlParts, quoteHtml: boolean) {
  if (!quoteHtml) {
    return `${parts.styles}${parts.headerHtml}${parts.bodyHtml}`;
  }
  // Wrap the entire quoted section (styles + header + blockquote) in a div for easy extraction
  return `<div id="noctua-quoted-html">${parts.styles}${parts.headerHtml}<blockquote type="cite" style="margin:0 0 0 .8ex;border-left:2px solid #cfcfcf;padding-left:1ex;">${parts.bodyHtml}</blockquote></div>`;
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
