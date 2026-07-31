import { escapeHtml } from "./strip";

// Inline-image rewriting for the HTML viewer: rewrite cid:… references to
// resolved URLs, append a fallback block for inline attachments the source
// never referenced, and drop our own fallback block if the source turned out
// to reference the image after all.

type InlineImageAttachment = {
  inline?: boolean;
  contentType?: string;
  filename?: string;
  cid?: string;
  url?: string;
};

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

export function isInlineImageReferenced(
  html: string,
  attachment: InlineImageAttachment
) {
  if (!html) return false;
  if (
    attachment.url &&
    (html.includes(attachment.url) || html.includes(escapeHtml(attachment.url)))
  ) {
    return true;
  }
  return getInlineReferenceCandidates(attachment).some((candidate) =>
    html.includes(`cid:${candidate}`)
  );
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
    if (isInlineImageReferenced(html, attachment)) return;
    snippets.push(snippet);
  });

  if (snippets.length === 0) return html;
  const block = `<div data-noctua-inline-images="1">${snippets.join("")}</div>`;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${block}</body>`);
  }
  return `${html}${block}`;
}
