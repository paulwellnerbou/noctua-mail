import { describe, expect, it } from "bun:test";
import {
  QUOTE_TEXT_SCAN_LIMIT,
  canWrapQuoteInParent,
  hasQuoteBoundaryMarker,
  isQuoteBoundary,
  isQuoteBoundaryText,
  isTableLayoutTag,
  shouldCollapseQuote,
  type QuoteBoundaryCandidate
} from "./quoteBoundary";

function candidate(overrides: Partial<QuoteBoundaryCandidate> = {}): QuoteBoundaryCandidate {
  return {
    tagName: "DIV",
    id: "",
    className: "",
    typeAttr: "",
    text: "",
    ...overrides
  };
}

describe("isQuoteBoundary", () => {
  it("matches our own quoted block marker", () => {
    expect(isQuoteBoundary(candidate({ id: "noctua-quoted-html" }))).toBe(true);
  });

  it("matches client-specific wrapper classes", () => {
    expect(isQuoteBoundary(candidate({ className: "gmail_quote_container" }))).toBe(true);
    expect(isQuoteBoundary(candidate({ className: "ltr moz-cite-prefix" }))).toBe(true);
    expect(isQuoteBoundary(candidate({ className: "yahoo_quoted" }))).toBe(true);
  });

  it("matches a cited blockquote but not a plain one", () => {
    expect(isQuoteBoundary(candidate({ tagName: "BLOCKQUOTE", typeAttr: "cite" }))).toBe(true);
    expect(isQuoteBoundary(candidate({ tagName: "BLOCKQUOTE", text: "a short quote" }))).toBe(false);
  });

  it("matches an Outlook header block whose fields ran together without <br> text", () => {
    // <br> contributes nothing to textContent, so fields collide ("16:41An:").
    const text =
      "Von: Erika Muster <erika@example.com> Gesendet: Montag, 27. April 2026 16:41An: " +
      "Max Beispiel <max@example.org>Cc: Kanzlei Beispiel <kanzlei@example.net>Betreff: " +
      "Re: Wohnung 02, Beispielstraße 109, Musterstadt";

    expect(isQuoteBoundary(candidate({ text }))).toBe(true);
  });

  it("matches the English Outlook header block", () => {
    const text =
      "From: Ada Lovelace <ada@example.com>Sent: Monday, 27 April 2026 16:41To: " +
      "Alan <alan@example.com>Subject: Re: Analytical Engine";

    expect(isQuoteBoundary(candidate({ text }))).toBe(true);
  });

  it("ignores a lone header-looking field", () => {
    expect(isQuoteBoundary(candidate({ text: "From: the desk of the CEO" }))).toBe(false);
    expect(isQuoteBoundary(candidate({ text: "Betreff: Rechnung 2026" }))).toBe(false);
  });

  it("does not read a header field out of the tail of a longer word", () => {
    const text = "From: Ada Lovelace <ada@example.com>Sent: MondayLastUpdate: 2026-04-27";

    expect(isQuoteBoundary(candidate({ text }))).toBe(false);
  });

  it("matches attribution lines in English and German", () => {
    expect(isQuoteBoundary(candidate({ text: "On 20.12.19 11:36, Ada Lovelace wrote:" }))).toBe(
      true
    );
    expect(
      isQuoteBoundary(
        candidate({
          text: "On Wed, Dec 18, 2019 at 8:17 PM Ada Lovelace <ada@example.com> wrote:"
        })
      )
    ).toBe(true);
    expect(
      isQuoteBoundary(candidate({ text: "Am 12.12.2019 um 17:50 schrieb Erika Muster:" }))
    ).toBe(true);
  });

  it("ignores an attribution phrase inside running text", () => {
    expect(
      isQuoteBoundary(
        candidate({
          text: "On Monday I checked the notes she wrote: they were incomplete, so I redid them."
        })
      )
    ).toBe(false);
  });

  it("matches forward separators", () => {
    expect(isQuoteBoundary(candidate({ text: "-----Original Message-----" }))).toBe(true);
    expect(isQuoteBoundary(candidate({ text: "-------- Weitergeleitete Nachricht --------" }))).toBe(
      true
    );
  });

  it("ignores empty and ordinary content", () => {
    expect(isQuoteBoundary(candidate())).toBe(false);
    expect(isQuoteBoundary(candidate({ text: "Mit freundlichen Grüßen" }))).toBe(false);
  });
});

describe("marker and text checks split apart", () => {
  it("matches markers without needing any text", () => {
    expect(hasQuoteBoundaryMarker({ tagName: "DIV", id: "", className: "gmail_quote", typeAttr: "" })).toBe(
      true
    );
    expect(hasQuoteBoundaryMarker({ tagName: "DIV", id: "", className: "", typeAttr: "" })).toBe(
      false
    );
  });

  it("reaches the same verdict on text truncated at the scan limit", () => {
    const header =
      "Von: Erika Muster <erika@example.com>Gesendet: Montag, 27. April 2026 16:41Betreff: Re: Test";
    const full = `${header}${"Weiterer zitierter Text. ".repeat(400)}`;

    expect(full.length).toBeGreaterThan(QUOTE_TEXT_SCAN_LIMIT);
    expect(isQuoteBoundaryText(full)).toBe(true);
    expect(isQuoteBoundaryText(full.slice(0, QUOTE_TEXT_SCAN_LIMIT))).toBe(true);
  });

  it("rejects an attribution line that only looks short once truncated", () => {
    const long = `On 20.12.19 11:36, Ada Lovelace wrote:${"x".repeat(2000)}`;

    expect(isQuoteBoundaryText(long)).toBe(false);
    expect(isQuoteBoundaryText(long.slice(0, QUOTE_TEXT_SCAN_LIMIT))).toBe(false);
  });
});

describe("shouldCollapseQuote", () => {
  it("collapses a long quote below a real message", () => {
    expect(shouldCollapseQuote({ leadingTextLength: 1300, quotedTextLength: 6500 })).toBe(true);
  });

  it("keeps a short quote expanded", () => {
    expect(shouldCollapseQuote({ leadingTextLength: 1300, quotedTextLength: 120 })).toBe(false);
  });

  it("keeps the quote expanded when it would hide the whole message", () => {
    expect(shouldCollapseQuote({ leadingTextLength: 0, quotedTextLength: 6500 })).toBe(false);
  });
});

describe("wrapping guards", () => {
  it("allows flow containers and rejects inline and table parents", () => {
    expect(canWrapQuoteInParent("div")).toBe(true);
    expect(canWrapQuoteInParent("BODY")).toBe(true);
    expect(canWrapQuoteInParent("P")).toBe(false);
    expect(canWrapQuoteInParent("SPAN")).toBe(false);
    expect(canWrapQuoteInParent("TD")).toBe(false);
  });

  it("detects table layout ancestors", () => {
    expect(isTableLayoutTag("tr")).toBe(true);
    expect(isTableLayoutTag("TABLE")).toBe(true);
    expect(isTableLayoutTag("DIV")).toBe(false);
  });
});
