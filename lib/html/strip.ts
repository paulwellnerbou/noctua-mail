import { decodeHTMLStrict } from "entities";

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

export function stripStyleTags(input: string) {
  return input.replace(/<style[\s\S]*?<\/style>/gi, "");
}

export function stripConditionalComments(input: string) {
  // Conditional comments come in two flavors that must be handled separately
  // because they can nest:
  //   * Downlevel-hidden  `<!--[if X]>...<![endif]-->`  — Outlook-only, drop.
  //   * Downlevel-revealed `<!--[if !X]><!-->...<!--<![endif]-->` — keep content.
  //
  // Some senders (eBay) place a hidden block *inside* a revealed one, so a
  // single non-greedy regex over both can latch onto the wrong `<![endif]-->`
  // and swallow tags in between. Strip hidden blocks first, then peel off
  // the revealed open/close markers.
  return input
    .replace(
      /<!--\s*\[if\s*(?!\s*!)[^\]]+\]\s*>[\s\S]*?<!\s*\[endif\s*\]\s*-->/gi,
      ""
    )
    .replace(
      /<!--\s*\[if\s*![^\]]+\]\s*>\s*(?:<!-->|<!--\s*-->|<!---->)?/gi,
      ""
    )
    .replace(/(?:<!--\s*)?<!\s*\[endif\s*\]\s*-->/gi, "");
}

/**
 * Regex-based HTML → text stripper used client-side for compose flows
 * (tab switching, quoted-parts extraction). Zero additional deps.
 *
 * For arbitrary external mail parsed server-side, use `html-to-text` via
 * `lib/mail/imap.ts` — a full parser handles malformed markup and comment /
 * CDATA edge cases that this regex approach does not.
 */
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
