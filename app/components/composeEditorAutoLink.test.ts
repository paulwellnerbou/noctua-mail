import { describe, expect, it } from "bun:test";
import { collectComposeAutoLinkMatches, findComposeAutoLinkMatch } from "./composeEditorAutoLink";

describe("findComposeAutoLinkMatch", () => {
  it("recognizes https urls", () => {
    expect(findComposeAutoLinkMatch("Open https://example.com/path")).toEqual({
      index: 5,
      length: "https://example.com/path".length,
      text: "https://example.com/path",
      url: "https://example.com/path"
    });
  });

  it("recognizes plain email addresses as mailto links", () => {
    expect(findComposeAutoLinkMatch("Email hello@example.com")).toEqual({
      index: 6,
      length: "hello@example.com".length,
      text: "hello@example.com",
      url: "mailto:hello@example.com"
    });
  });

  it("keeps explicit mailto links intact", () => {
    expect(findComposeAutoLinkMatch("mailto:hello@example.com")).toEqual({
      index: 0,
      length: "mailto:hello@example.com".length,
      text: "mailto:hello@example.com",
      url: "mailto:hello@example.com"
    });
  });

  it("excludes trailing punctuation from https urls", () => {
    expect(findComposeAutoLinkMatch("Visit https://example.com.")).toEqual({
      index: 6,
      length: "https://example.com".length,
      text: "https://example.com",
      url: "https://example.com"
    });
  });

  it("excludes trailing punctuation from email addresses", () => {
    expect(findComposeAutoLinkMatch("Email hello@example.com,")).toEqual({
      index: 6,
      length: "hello@example.com".length,
      text: "hello@example.com",
      url: "mailto:hello@example.com"
    });
  });

  it("ignores unsupported or incomplete inputs", () => {
    expect(findComposeAutoLinkMatch("example")).toBeNull();
    expect(findComposeAutoLinkMatch("hello@")).toBeNull();
    expect(findComposeAutoLinkMatch("ftp://example.com")).toBeNull();
  });
});

describe("collectComposeAutoLinkMatches", () => {
  it("finds multiple links in a single line", () => {
    expect(
      collectComposeAutoLinkMatches("Use https://example.com or email hello@example.com today.")
    ).toEqual([
      {
        index: 4,
        length: "https://example.com".length,
        text: "https://example.com",
        url: "https://example.com"
      },
      {
        index: 33,
        length: "hello@example.com".length,
        text: "hello@example.com",
        url: "mailto:hello@example.com"
      }
    ]);
  });
});
