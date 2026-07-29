import { describe, expect, it } from "bun:test";
import {
  canWrapQuoteInParent,
  isQuoteBoundary,
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
    const text =
      "Von: Paul Wellner Bou <paul@wellnerbou.de> Gesendet: Montag, 27. April 2026 16:41An: " +
      "Bernd Georg Stillger <bgs@bundsag.de>Cc: PH30 Eva Bertus <info@bertus-recht.de>Betreff: " +
      "Re: ETW 02, Dotzheimer Straße 109, Wiesbaden";

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

  it("matches attribution lines in English and German", () => {
    expect(
      isQuoteBoundary(candidate({ text: "On 20.12.19 11:36, Paul Wellner Bou wrote:" }))
    ).toBe(true);
    expect(
      isQuoteBoundary(
        candidate({
          text: "On Wed, Dec 18, 2019 at 8:17 PM Paul Wellner Bou <paul@wellnerbou.de> wrote:"
        })
      )
    ).toBe(true);
    expect(
      isQuoteBoundary(candidate({ text: "Am 12.12.2019 um 17:50 schrieb Bernd Georg Stillger:" }))
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
