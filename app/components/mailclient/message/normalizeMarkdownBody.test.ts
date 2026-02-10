import { describe, expect, it } from "bun:test";
import { normalizeMarkdownBody } from "./normalizeMarkdownBody";

describe("normalizeMarkdownBody", () => {
  it("normalizes malformed duplicate markdown url syntax", () => {
    const url = "https://youtu.be/0UPX0qVJ8H8";

    expect(normalizeMarkdownBody(`${url} [${url}]`)).toBe(`<${url}>`);
  });

  it("keeps mismatched bracket url text unchanged", () => {
    expect(normalizeMarkdownBody("https://example.com [https://example.org]")).toBe(
      "https://example.com [https://example.org]"
    );
  });

  it("preserves existing asterisk spacing normalization", () => {
    expect(normalizeMarkdownBody("Hello *world*again")).toBe("Hello *world* again");
  });
});
