// Finding where an incoming message stops being the sender's own words and
// starts quoting the thread. Every mail client marks that spot differently (or
// not at all), so this is a curated marker list plus a size guard — a marker
// only counts as a boundary when enough text sits above it and enough quoted
// text below, otherwise collapsing would hide the message instead of the quote.
//
// The DOM walk that applies these rules lives in HtmlMessage; everything here
// stays free of DOM types so it can be tested without a browser environment.

/** The attribute-only half of a candidate, cheap enough to test on every element. */
export type QuoteBoundaryMarkers = {
  tagName: string;
  id: string;
  className: string;
  typeAttr: string;
};

export type QuoteBoundaryCandidate = QuoteBoundaryMarkers & {
  text: string;
};

/** How far into an element's text the header and separator rules look. */
const HEAD_SCAN_LENGTH = 1000;

/**
 * Longest text prefix any rule inspects, so callers reading text out of a DOM
 * can stop here instead of materializing a whole subtree. Truncating at exactly
 * this length is lossless: the head rules read no further, and an attribution
 * line is rejected on length alone well before it (ATTRIBUTION_MAX_LENGTH).
 * Text handed in must already have its leading whitespace dropped, which trim()
 * would otherwise remove after the budget was spent on it.
 */
export const QUOTE_TEXT_SCAN_LIMIT = HEAD_SCAN_LENGTH;

/** Both lengths count non-whitespace characters of visible text. */
export type QuoteSizes = {
  leadingTextLength: number;
  quotedTextLength: number;
};

/** Below this the quote is short enough that a collapse chip is more noise than the quote. */
export const QUOTE_COLLAPSE_MIN_QUOTED_CHARS = 400;

/** Guards against collapsing a message whose own content is a single line or empty. */
export const QUOTE_COLLAPSE_MIN_LEADING_CHARS = 20;

const ATTRIBUTION_MAX_LENGTH = 400;

const BOUNDARY_IDS = new Set([
  "noctua-quoted-html",
  "appendonsend",
  "divrplyfwdmsg",
  "mail-editor-reference-message-container",
  "stopspelling",
  "olk_src_body_section"
]);

const BOUNDARY_CLASSES = new Set([
  "gmail_quote",
  "gmail_quote_container",
  "yahoo_quoted",
  "moz-cite-prefix",
  "protonmail_quote",
  "zmail_extra",
  "outlookmessageheader"
]);

// <br> contributes nothing to textContent, so header fields run into whatever
// preceded them ("…@example.com>Betreff:", "16:41Betreff:"). Anchoring on a
// preceding non-letter catches both — \b would not, since digit-to-letter is
// no boundary — while still keeping "Update:" from matching "date:".
const HEADER_BLOCK_START = /^(?:von|from)\s*:/i;
const HEADER_BLOCK_SENT = /(?:^|[^\p{L}])(?:gesendet|sent|datum|date)\s*:/iu;
const HEADER_BLOCK_SUBJECT = /(?:^|[^\p{L}])(?:betreff|subject)\s*:/iu;

const FORWARD_SEPARATOR =
  /^-{2,}\s*(?:original message|ursprüngliche nachricht|weitergeleitete nachricht|forwarded message)\s*-{2,}/i;

// The attribution line is its own paragraph, so requiring it to be the whole
// text keeps "wrote:" inside a running sentence from matching.
const ATTRIBUTION_LINE =
  /^(?:on\b[\s\S]{0,300}?\bwrote\s*:|am\b[\s\S]{0,300}?\bschrieb\b[\s\S]{0,200}?:)$/i;

/** Flow containers a <details> wrapper can be inserted into without breaking layout. */
const WRAPPABLE_PARENT_TAGS = new Set([
  "BODY",
  "DIV",
  "SECTION",
  "ARTICLE",
  "MAIN",
  "BLOCKQUOTE",
  "LI",
  "CENTER",
  "FORM"
]);

const TABLE_LAYOUT_TAGS = new Set(["TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH"]);

export function hasQuoteBoundaryMarker(markers: QuoteBoundaryMarkers): boolean {
  const id = markers.id.trim().toLowerCase();
  if (id && BOUNDARY_IDS.has(id)) {
    return true;
  }

  const classNames = markers.className.toLowerCase().split(/\s+/);
  if (classNames.some((name) => name && BOUNDARY_CLASSES.has(name))) {
    return true;
  }

  return (
    markers.tagName.toUpperCase() === "BLOCKQUOTE" &&
    markers.typeAttr.trim().toLowerCase() === "cite"
  );
}

/** Safe on text truncated to QUOTE_TEXT_SCAN_LIMIT — no rule reads beyond it. */
export function isQuoteBoundaryText(rawText: string): boolean {
  const text = rawText.trim();
  if (!text) {
    return false;
  }

  const head = text.slice(0, HEAD_SCAN_LENGTH);
  if (FORWARD_SEPARATOR.test(head)) {
    return true;
  }
  if (
    HEADER_BLOCK_START.test(head) &&
    HEADER_BLOCK_SENT.test(head) &&
    HEADER_BLOCK_SUBJECT.test(head)
  ) {
    return true;
  }

  return text.length <= ATTRIBUTION_MAX_LENGTH && ATTRIBUTION_LINE.test(text);
}

export function isQuoteBoundary(candidate: QuoteBoundaryCandidate): boolean {
  return hasQuoteBoundaryMarker(candidate) || isQuoteBoundaryText(candidate.text);
}

export function shouldCollapseQuote(sizes: QuoteSizes): boolean {
  return (
    sizes.leadingTextLength >= QUOTE_COLLAPSE_MIN_LEADING_CHARS &&
    sizes.quotedTextLength >= QUOTE_COLLAPSE_MIN_QUOTED_CHARS
  );
}

export function canWrapQuoteInParent(parentTagName: string): boolean {
  return WRAPPABLE_PARENT_TAGS.has(parentTagName.toUpperCase());
}

export function isTableLayoutTag(tagName: string): boolean {
  return TABLE_LAYOUT_TAGS.has(tagName.toUpperCase());
}
