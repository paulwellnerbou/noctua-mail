import { describe, expect, it } from "bun:test";
import { stripHtmlToText } from "@/lib/html";
import {
  computeBodyOnSwitchToText,
  computeHtmlOnSwitchToHtml,
  computeMarkdownOnSwitchToMarkdown
} from "./composeTabSwitch";
import type { TextBodyParams } from "./composeTabSwitch";

// Minimal stripHtml that removes tags and collapses whitespace
const stripHtml = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripDeps = { stripHtml };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textParams(overrides: Partial<TextBodyParams> = {}): TextBodyParams {
  return {
    lastEdited: "html",
    composeHtml: "",
    composeHtmlText: "",
    composeMarkdown: "",
    composeQuotedParts: null,
    composeQuotedHtml: "",
    composeIncludeOriginal: true,
    ...overrides
  };
}

const QUOTED_PARTS = {
  styles: "",
  headerHtml: "<p>On Mon, Alice wrote:</p>",
  bodyHtml: "<p>Hello</p><p>World</p>"
};

// ---------------------------------------------------------------------------
// computeBodyOnSwitchToText
// ---------------------------------------------------------------------------

describe("computeBodyOnSwitchToText – from HTML", () => {
  it("fresh HTML reply: shows quoted content with > prefix, user content empty", () => {
    const result = computeBodyOnSwitchToText(
      textParams({ composeQuotedParts: QUOTED_PARTS }),
      stripDeps
    );
    expect(result).toContain("On Mon, Alice wrote:");
    // stripHtml collapses block elements to spaces; all body text lands on one > line
    expect(result).toMatch(/^>\s/m);
    expect(result).toContain("Hello");
    expect(result).toContain("World");
  });

  it("HTML reply with user content: combines user text and quoted text", () => {
    const result = computeBodyOnSwitchToText(
      textParams({
        composeHtmlText: "My reply",
        composeQuotedParts: QUOTED_PARTS
      }),
      stripDeps
    );
    expect(result).toMatch(/^My reply/);
    expect(result).toContain("On Mon, Alice wrote:");
    expect(result).toContain("> Hello");
  });

  it("separates user text and quoted text with a blank line", () => {
    const result = computeBodyOnSwitchToText(
      textParams({
        composeHtmlText: "My reply",
        composeQuotedParts: QUOTED_PARTS
      }),
      stripDeps
    );
    expect(result).toContain("My reply\n\nOn Mon, Alice wrote:");
  });

  it("no quoted parts, no quoted HTML: returns only user text", () => {
    const result = computeBodyOnSwitchToText(
      textParams({ composeHtmlText: "My reply" }),
      stripDeps
    );
    expect(result).toBe("My reply");
  });

  it("falls back to stripHtml(composeHtml) when composeHtmlText is empty", () => {
    const result = computeBodyOnSwitchToText(
      textParams({ composeHtml: "<p>My reply</p>" }),
      stripDeps
    );
    expect(result).toContain("My reply");
  });

  it("decodes html entities in quoted header content", () => {
    const result = computeBodyOnSwitchToText(
      textParams({
        composeQuotedParts: {
          styles: "",
          headerHtml:
            "<p>On 2026-03-25 10:22, &quot;Paul Wellner Bou&quot; &lt;paul@example.com&gt; wrote:</p>",
          bodyHtml: "<p>Hallo</p>"
        }
      }),
      { stripHtml: stripHtmlToText }
    );
    expect(result).toContain('On 2026-03-25 10:22, "Paul Wellner Bou" <paul@example.com> wrote:');
    expect(result).not.toContain("&quot;");
    expect(result).not.toContain("&lt;");
  });

  it("uses composeQuotedHtml when composeQuotedParts is null", () => {
    const result = computeBodyOnSwitchToText(
      textParams({ composeQuotedHtml: "<p>Fallback quoted</p>" }),
      stripDeps
    );
    expect(result).toContain("Fallback quoted");
  });

  it("excludes quoted content when composeIncludeOriginal is false", () => {
    const result = computeBodyOnSwitchToText(
      textParams({
        composeQuotedParts: QUOTED_PARTS,
        composeIncludeOriginal: false
      }),
      stripDeps
    );
    expect(result).toBe("");
    expect(result).not.toContain("Alice");
  });

  it("returns empty string when nothing to show", () => {
    const result = computeBodyOnSwitchToText(textParams(), stripDeps);
    expect(result).toBe("");
  });

  // composeHtmlText holds the editor's body text. A toggle in ComposeMessageField
  // followed by a switch to the Text tab must produce body-then-quoted with no
  // duplication. If a future change overwrites composeHtmlText with the stripped
  // quoted text inside a toggle handler, "My reply" would disappear and "Alice"
  // would appear twice, failing this test.
  it("toggle-then-switch preserves body and does not duplicate quoted text", () => {
    const result = computeBodyOnSwitchToText(
      textParams({
        composeHtmlText: "My reply",
        composeQuotedParts: QUOTED_PARTS
      }),
      stripDeps
    );
    expect(result.match(/My reply/g)?.length).toBe(1);
    expect(result.match(/Alice/g)?.length).toBe(1);
    expect(result.indexOf("My reply")).toBeLessThan(result.indexOf("Alice"));
  });
});

describe("computeBodyOnSwitchToText – from Markdown", () => {
  it("strips HTML tags from markdown content", () => {
    const result = computeBodyOnSwitchToText(
      textParams({ lastEdited: "markdown", composeMarkdown: "**Hello** world" }),
      stripDeps
    );
    expect(result).toContain("Hello");
    expect(result).toContain("world");
    expect(result).not.toContain("<");
  });

  it("includes quoted content when coming from markdown and quoted parts present", () => {
    const result = computeBodyOnSwitchToText(
      textParams({
        lastEdited: "markdown",
        composeMarkdown: "My response",
        composeQuotedParts: QUOTED_PARTS
      }),
      stripDeps
    );
    expect(result).toContain("My response");
    expect(result).toContain("On Mon, Alice wrote:");
    expect(result).toContain("> Hello");
  });

  it("fresh markdown reply (no user content): shows only quoted text", () => {
    const result = computeBodyOnSwitchToText(
      textParams({
        lastEdited: "markdown",
        composeMarkdown: "",
        composeQuotedParts: QUOTED_PARTS
      }),
      stripDeps
    );
    expect(result).toContain("On Mon, Alice wrote:");
    expect(result).not.toMatch(/^\n/);
  });
});

describe("computeBodyOnSwitchToText – from Text (no-op)", () => {
  it("returns empty string when lastEdited is already text (caller keeps current body)", () => {
    const result = computeBodyOnSwitchToText(
      textParams({ lastEdited: "text", composeHtmlText: "should be ignored" }),
      stripDeps
    );
    expect(result).toBe("");
  });
});

// ---------------------------------------------------------------------------
// computeHtmlOnSwitchToHtml
// ---------------------------------------------------------------------------

describe("computeHtmlOnSwitchToHtml – from Text", () => {
  it("wraps plain text in a paragraph", () => {
    const result = computeHtmlOnSwitchToHtml(
      { lastEdited: "text", composeBody: "Hello world", composeMarkdown: "" },
      stripDeps
    );
    expect(result?.html).toBe("<p>Hello world</p>");
  });

  it("converts newlines to <br>", () => {
    const result = computeHtmlOnSwitchToHtml(
      { lastEdited: "text", composeBody: "Line 1\nLine 2", composeMarkdown: "" },
      stripDeps
    );
    expect(result?.html).toContain("<br>");
  });

  it("returns empty html when composeBody is empty", () => {
    const result = computeHtmlOnSwitchToHtml(
      { lastEdited: "text", composeBody: "", composeMarkdown: "" },
      stripDeps
    );
    expect(result?.html).toBe("");
  });

  it("escapes HTML special characters in text", () => {
    const result = computeHtmlOnSwitchToHtml(
      { lastEdited: "text", composeBody: "<script>alert(1)</script>", composeMarkdown: "" },
      stripDeps
    );
    expect(result?.html).not.toContain("<script>");
    expect(result?.html).toContain("&lt;script&gt;");
  });

  it("computes htmlText as stripped html", () => {
    const result = computeHtmlOnSwitchToHtml(
      { lastEdited: "text", composeBody: "Hello", composeMarkdown: "" },
      stripDeps
    );
    expect(result?.htmlText).toBe("Hello");
  });
});

describe("computeHtmlOnSwitchToHtml – from Markdown", () => {
  it("converts markdown to html", () => {
    const result = computeHtmlOnSwitchToHtml(
      { lastEdited: "markdown", composeBody: "", composeMarkdown: "**Bold**" },
      stripDeps
    );
    expect(result?.html).toContain("<strong>Bold</strong>");
  });
});

describe("computeHtmlOnSwitchToHtml – from HTML", () => {
  it("returns null (Lexical editor owns content, no update needed)", () => {
    const result = computeHtmlOnSwitchToHtml(
      { lastEdited: "html", composeBody: "", composeMarkdown: "" },
      stripDeps
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeMarkdownOnSwitchToMarkdown
// ---------------------------------------------------------------------------

describe("computeMarkdownOnSwitchToMarkdown – from HTML", () => {
  it("converts simple HTML to markdown", () => {
    const result = computeMarkdownOnSwitchToMarkdown({
      lastEdited: "html",
      composeBody: "",
      composeHtml: "<p>Hello world</p>"
    });
    expect(result).toContain("Hello world");
  });

  it("converts bold HTML to markdown bold", () => {
    const result = computeMarkdownOnSwitchToMarkdown({
      lastEdited: "html",
      composeBody: "",
      composeHtml: "<p><strong>Bold</strong></p>"
    });
    expect(result).toContain("**Bold**");
  });

  it("returns empty string for empty HTML", () => {
    const result = computeMarkdownOnSwitchToMarkdown({
      lastEdited: "html",
      composeBody: "",
      composeHtml: ""
    });
    expect(result).toBe("");
  });
});

describe("computeMarkdownOnSwitchToMarkdown – from Text", () => {
  it("converts plain text to markdown", () => {
    const result = computeMarkdownOnSwitchToMarkdown({
      lastEdited: "text",
      composeBody: "Hello world",
      composeHtml: ""
    });
    expect(result).toContain("Hello world");
  });
});

describe("computeMarkdownOnSwitchToMarkdown – from Markdown", () => {
  it("returns null (no conversion needed)", () => {
    const result = computeMarkdownOnSwitchToMarkdown({
      lastEdited: "markdown",
      composeBody: "",
      composeHtml: ""
    });
    expect(result).toBeNull();
  });
});
