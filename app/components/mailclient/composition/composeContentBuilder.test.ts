import { describe, expect, it } from "bun:test";
import { buildComposePayload, buildTextReplyBody, formatQuotedBody } from "./composeContentBuilder";
import type { ComposeContentState } from "./composeContentBuilder";

const noop = (s: string) => s;
const deps = { stripHtml: noop, normalizeHtmlDerivedText: noop };

function makeState(overrides: Partial<ComposeContentState> = {}): ComposeContentState {
  return {
    composeTab: "text",
    composeBody: "",
    composeHtml: "",
    composeMarkdown: "",
    composeQuotedHtml: "",
    composeQuotedHtmlEdited: false,
    composeIncludeOriginal: true,
    composeStripImages: false,
    composeAttachments: [],
    ...overrides
  };
}

describe("formatQuotedBody", () => {
  it("prefixes each line with > and adds a header", () => {
    const result = formatQuotedBody("Hello\nWorld", "On date, Alice wrote:");
    expect(result).toBe("\n\nOn date, Alice wrote:\n> Hello\n> World");
  });

  it("trims trailing spaces from quoted lines", () => {
    const result = formatQuotedBody("Hello   ", "Header:");
    expect(result).toBe("\n\nHeader:\n> Hello");
  });

  it("handles empty body", () => {
    const result = formatQuotedBody("", "Header:");
    expect(result).toBe("\n\nHeader:\n>");
  });
});

describe("buildTextReplyBody", () => {
  it("returns the formatted quoted body without leading newlines", () => {
    const result = buildTextReplyBody("Original message", "On date, Alice wrote:");
    expect(result).toBe("On date, Alice wrote:\n> Original message");
  });

  it("handles multi-line original body", () => {
    const result = buildTextReplyBody("Line 1\nLine 2", "Header:");
    expect(result).toBe("Header:\n> Line 1\n> Line 2");
  });

  it("does not start with newlines (leading newlines are stripped)", () => {
    const result = buildTextReplyBody("body", "Header:");
    expect(result.startsWith("\n")).toBe(false);
  });
});

describe("buildComposePayload — text mode", () => {
  it("returns plain text body as-is (trimmed)", () => {
    const result = buildComposePayload(makeState({ composeBody: "Hello world" }), deps);
    expect(result.composeFormat).toBe("text");
    expect(result.text).toBe("Hello world");
    expect(result.html).toBeUndefined();
    expect(result.markdown).toBeUndefined();
  });

  it("returns body that already contains quoted text (no separate appending)", () => {
    const body = buildTextReplyBody("Original message", "On date, Alice wrote:");
    const result = buildComposePayload(makeState({ composeBody: body }), deps);
    expect(result.text).toBe("On date, Alice wrote:\n> Original message");
  });

  it("trims leading and trailing whitespace from body", () => {
    const result = buildComposePayload(makeState({ composeBody: "  Hello  " }), deps);
    expect(result.text).toBe("Hello");
  });

  it("handles empty body", () => {
    const result = buildComposePayload(makeState({ composeBody: "" }), deps);
    expect(result.text).toBe("");
  });

  it("falls back to text mode when preferText is true and tab is html", () => {
    const result = buildComposePayload(
      makeState({
        composeTab: "html",
        composeBody: "Plain text fallback",
        composeHtml: "<p>HTML content</p>"
      }),
      deps,
      { preferText: true }
    );
    expect(result.composeFormat).toBe("text");
    expect(result.html).toBeUndefined();
  });
});

describe("buildComposePayload — html mode", () => {
  it("returns html body", () => {
    const result = buildComposePayload(
      makeState({ composeTab: "html", composeHtml: "<p>Hello</p>" }),
      deps
    );
    expect(result.composeFormat).toBe("html");
    expect(result.html).toContain("<p>Hello</p>");
  });

  it("appends quoted html when composeIncludeOriginal is true and not edited", () => {
    const result = buildComposePayload(
      makeState({
        composeTab: "html",
        composeHtml: "<p>Reply</p>",
        composeQuotedHtml: "<blockquote>Original</blockquote>",
        composeQuotedHtmlEdited: false
      }),
      deps
    );
    expect(result.html).toContain("<p>Reply</p>");
    expect(result.html).toContain("<blockquote>Original</blockquote>");
  });

  it("excludes quoted html when composeQuotedHtmlEdited is true", () => {
    const result = buildComposePayload(
      makeState({
        composeTab: "html",
        composeHtml: "<p>Reply</p>",
        composeQuotedHtml: "<blockquote>Original</blockquote>",
        composeQuotedHtmlEdited: true
      }),
      deps
    );
    expect(result.html).not.toContain("<blockquote>Original</blockquote>");
  });

  it("excludes quoted html when composeIncludeOriginal is false", () => {
    const result = buildComposePayload(
      makeState({
        composeTab: "html",
        composeHtml: "<p>Reply</p>",
        composeQuotedHtml: "<blockquote>Original</blockquote>",
        composeIncludeOriginal: false
      }),
      deps
    );
    expect(result.html).not.toContain("<blockquote>Original</blockquote>");
  });

  it("strips img tags when composeStripImages is true", () => {
    const result = buildComposePayload(
      makeState({
        composeTab: "html",
        composeHtml: '<p>Hello</p><img src="http://example.com/img.png">',
        composeStripImages: true
      }),
      deps
    );
    expect(result.html).not.toContain("<img");
    expect(result.html).toContain("<p>Hello</p>");
  });

  it("uses composeAssembledQuotedHtml in the payload, ignoring stale composeQuotedHtml", () => {
    const result = buildComposePayload(
      makeState({
        composeTab: "html",
        composeHtml: "<p>Reply</p>",
        composeQuotedHtml: "stale and should be ignored",
        composeAssembledQuotedHtml:
          '<div id="noctua-quoted-html"><p>Header line</p><blockquote><p>Original body</p></blockquote></div>'
      }),
      deps
    );
    expect(result.html).toContain("<p>Reply</p>");
    expect(result.html).toContain("Header line");
    expect(result.html).toContain("Original body");
    expect(result.html).toContain("<blockquote");
    expect(result.html).not.toContain("stale and should be ignored");
  });

  it("uses the assembled HTML the caller provides — quoteHtml flag is the caller's responsibility", () => {
    const result = buildComposePayload(
      makeState({
        composeTab: "html",
        composeHtml: "<p>Reply</p>",
        composeAssembledQuotedHtml:
          '<div id="noctua-quoted-html"><p>Header line</p><div><p>Original body</p></div></div>'
      }),
      deps
    );
    expect(result.html).toContain("Original body");
    expect(result.html).not.toContain("<blockquote");
  });

  it("falls back to composeQuotedHtml when composeAssembledQuotedHtml is null", () => {
    const result = buildComposePayload(
      makeState({
        composeTab: "html",
        composeHtml: "<p>Reply</p>",
        composeQuotedHtml: "<blockquote>From draft</blockquote>",
        composeAssembledQuotedHtml: null
      }),
      deps
    );
    expect(result.html).toContain("<blockquote>From draft</blockquote>");
  });

  it("excludes the quote when composeQuotedHtmlEdited is true even if assembled HTML is provided", () => {
    const result = buildComposePayload(
      makeState({
        composeTab: "html",
        composeHtml: "<p>Reply already contains the quote</p>",
        composeQuotedHtml: "<blockquote>edited inline</blockquote>",
        composeAssembledQuotedHtml:
          '<div id="noctua-quoted-html"><p>Header</p><p>Body</p></div>',
        composeQuotedHtmlEdited: true
      }),
      deps
    );
    expect(result.html).toContain("<p>Reply already contains the quote</p>");
    expect(result.html).not.toContain("<p>Body</p>");
  });

  it("replaces inline attachment data URLs with cid: references", () => {
    const dataUrl = "data:image/png;base64,ABC123";
    const cid = "unique-cid@mail";
    const result = buildComposePayload(
      makeState({
        composeTab: "html",
        composeHtml: `<p>Hello</p><img src="${dataUrl}">`,
        composeAttachments: [
          {
            filename: "inline.png",
            contentType: "image/png",
            size: 100,
            inline: true,
            dataUrl,
            cid
          }
        ]
      }),
      deps
    );
    expect(result.html).toContain(`cid:${cid}`);
    expect(result.html).not.toContain(dataUrl);
  });
});

describe("buildComposePayload — markdown mode", () => {
  it("returns markdown content", () => {
    const result = buildComposePayload(
      makeState({ composeTab: "markdown", composeMarkdown: "**Hello**" }),
      deps
    );
    expect(result.composeFormat).toBe("markdown");
    expect(result.markdown).toBe("**Hello**");
  });

  it("strips html tags from markdown for the text/plain part", () => {
    const result = buildComposePayload(
      makeState({
        composeTab: "markdown",
        composeMarkdown: "Hello <span>world</span>"
      }),
      deps
    );
    expect(result.text).toBe("Hello world");
  });

  it("includes quoted html when composeIncludeOriginal is true and not edited", () => {
    const result = buildComposePayload(
      makeState({
        composeTab: "markdown",
        composeMarkdown: "My reply",
        composeQuotedHtml: "<blockquote>Original</blockquote>",
        composeQuotedHtmlEdited: false
      }),
      deps
    );
    expect(result.html).toContain("<blockquote>Original</blockquote>");
  });

  it("omits quoted html when composeQuotedHtmlEdited is true", () => {
    const result = buildComposePayload(
      makeState({
        composeTab: "markdown",
        composeMarkdown: "My reply",
        composeQuotedHtml: "<blockquote>Original</blockquote>",
        composeQuotedHtmlEdited: true
      }),
      deps
    );
    expect(result.html).toBeUndefined();
  });

  it("falls back to text mode when preferText is true", () => {
    const result = buildComposePayload(
      makeState({
        composeTab: "markdown",
        composeMarkdown: "**Bold**",
        composeBody: "plain"
      }),
      deps,
      { preferText: true }
    );
    expect(result.composeFormat).toBe("text");
  });
});
