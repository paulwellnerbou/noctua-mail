// Public API for @/lib/html.
//
// Implementation is split across sibling files:
//   - sanitize.ts: sanitizeHtmlForDisplay (security allowlist for the viewer)
//   - strip.ts: escape / decode / strip helpers + stripHtmlToText
//   - extract.ts: pull visible text, preferred document, or body out of raw HTML
//   - document.ts: viewer-frame heuristic + ensureHtmlDocumentTitle
//   - linkify.ts: auto-linkify bare URLs in HTML text nodes
//   - inlineImages.ts: inline-image rewriting (cid: <-> resolved URL)
//   - quotedParts.ts: build / assemble / extract the "quoted original" block
//
// Prefer importing from "@/lib/html" rather than the sibling files directly;
// the re-exports here keep the surface stable for the rest of the codebase.

export { sanitizeHtmlForDisplay } from "./sanitize";
export {
  escapeHtml,
  decodeHtmlEntities,
  stripStyleTags,
  stripConditionalComments,
  stripHtmlToText
} from "./strip";
export {
  extractVisibleHtmlText,
  selectPreferredHtmlDocument,
  extractBodyContent,
  extractHtmlBody
} from "./extract";
export { shouldShowHtmlViewerFrame, ensureHtmlDocumentTitle } from "./document";
export { linkifyHtmlTextNodes } from "./linkify";
export { enforceSafeLinks } from "./safeLinks";
export {
  isInlineImageReferenced,
  replaceInlineImageSources,
  stripRedundantInlineImageFallbacks,
  appendUnreferencedInlineImages
} from "./inlineImages";
export type { QuotedHtmlParts } from "./quotedParts";
export {
  buildQuotedHtmlPartsFromText,
  buildQuotedHtmlPartsFromHtml,
  assembleQuotedHtml,
  extractQuotedHtmlFromDraft
} from "./quotedParts";
