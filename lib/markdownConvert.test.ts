import { describe, expect, it } from "bun:test";
import { markdownToHtml, htmlToMarkdown, textToMarkdown } from "./markdownConvert";

describe("markdownToHtml", () => {
  it("converts basic markdown to HTML", () => {
    const result = markdownToHtml("# Hello\n\nWorld");
    expect(result).toContain("<h1");
    expect(result).toContain("Hello");
    expect(result).toContain("<p>");
    expect(result).toContain("World");
  });

  it("handles code blocks with language", () => {
    const result = markdownToHtml("```js\nconsole.log('hi');\n```");
    expect(result).toContain("<code");
    expect(result).toContain("language-js");
  });

  it("returns empty string for empty input", () => {
    expect(markdownToHtml("")).toBe("");
    expect(markdownToHtml("   ")).toBe("");
  });

  it("handles GFM tables", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    const result = markdownToHtml(md);
    expect(result).toContain("<table>");
  });

  it("handles bold and italic", () => {
    const result = markdownToHtml("**bold** and *italic*");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("<em>italic</em>");
  });

  it("handles links", () => {
    const result = markdownToHtml("[Example](https://example.com)");
    expect(result).toContain('<a href="https://example.com"');
    expect(result).toContain("Example");
  });

  it("handles lists", () => {
    const md = "- item 1\n- item 2\n- item 3";
    const result = markdownToHtml(md);
    expect(result).toContain("<ul>");
    expect(result).toContain("<li>");
  });

  it("handles line breaks with breaks:true", () => {
    const result = markdownToHtml("Line 1\nLine 2");
    expect(result).toContain("<br>");
  });
});

describe("htmlToMarkdown", () => {
  it("converts basic HTML to markdown", () => {
    const result = htmlToMarkdown("<h1>Hello</h1><p>World</p>");
    expect(result).toContain("# Hello");
    expect(result).toContain("World");
  });

  it("returns empty string for empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
  });

  it("converts bold to markdown", () => {
    const result = htmlToMarkdown("<p>This is <strong>bold</strong></p>");
    expect(result).toContain("**bold**");
  });

  it("converts links to markdown", () => {
    const result = htmlToMarkdown('<a href="https://example.com">Example</a>');
    expect(result).toContain("[Example](https://example.com)");
  });
});

describe("textToMarkdown", () => {
  it("passes text through directly", () => {
    expect(textToMarkdown("Hello\nWorld")).toBe("Hello\nWorld");
  });

  it("handles empty string", () => {
    expect(textToMarkdown("")).toBe("");
  });
});

describe("round-trip conversions", () => {
  it("markdown -> html -> markdown preserves headings", () => {
    const md = "# Hello World";
    const html = markdownToHtml(md);
    const back = htmlToMarkdown(html);
    expect(back.trim()).toContain("# Hello World");
  });

  it("markdown -> html -> markdown preserves code blocks", () => {
    const md = "```js\nconst x = 1;\n```";
    const html = markdownToHtml(md);
    const back = htmlToMarkdown(html);
    expect(back).toContain("const x = 1;");
    expect(back).toContain("```");
  });
});
