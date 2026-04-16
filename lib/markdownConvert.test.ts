import { describe, expect, it } from "bun:test";
import { htmlToMarkdown, markdownToHtml, textToMarkdown } from "./markdownConvert";

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
    expect(markdownToHtml("\n\n\t")).toBe("");
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

  // Snapshot-style coverage to verify the pipeline matches the display path
  // (react-markdown + remark-gfm + remark-breaks).
  describe("structural coverage", () => {
    it("renders all six heading levels", () => {
      const md = "# h1\n## h2\n### h3\n#### h4\n##### h5\n###### h6";
      const result = markdownToHtml(md);
      for (let level = 1; level <= 6; level += 1) {
        expect(result).toContain(`<h${level}>h${level}</h${level}>`);
      }
    });

    it("renders strikethrough (GFM)", () => {
      const result = markdownToHtml("~~gone~~");
      expect(result).toContain("<del>gone</del>");
    });

    it("renders inline code", () => {
      const result = markdownToHtml("use `fn()` please");
      expect(result).toContain("<code>fn()</code>");
    });

    it("renders ordered lists", () => {
      const md = "1. first\n2. second\n3. third";
      const result = markdownToHtml(md);
      expect(result).toContain("<ol>");
      expect(result).toContain("<li>first</li>");
      expect(result).toContain("<li>second</li>");
    });

    it("renders nested lists", () => {
      const md = "- a\n  - a1\n  - a2\n- b";
      const result = markdownToHtml(md);
      expect(result).toMatch(/<ul>[\s\S]*<ul>[\s\S]*<\/ul>[\s\S]*<\/ul>/);
      expect(result).toContain("a1");
    });

    it("renders GFM tables with thead and tbody", () => {
      const md = [
        "| Left | Center | Right |",
        "|:-----|:------:|------:|",
        "| a    | b      | c     |",
        "| 1    | 2      | 3     |",
      ].join("\n");
      const result = markdownToHtml(md);
      expect(result).toContain("<table>");
      expect(result).toContain("<thead>");
      expect(result).toContain("<tbody>");
      expect(result).toContain("<th");
      expect(result).toContain("<td");
      // alignment metadata should be present (as align attribute or style)
      expect(result).toMatch(/align="center"|text-align:\s*center/);
    });

    it("renders fenced code blocks with language class", () => {
      const result = markdownToHtml("```ts\nconst x: number = 1;\n```");
      expect(result).toContain("<pre>");
      expect(result).toContain('class="language-ts"');
      expect(result).toContain("const x: number = 1;");
    });

    it("renders single and nested blockquotes", () => {
      const single = markdownToHtml("> quote");
      expect(single).toContain("<blockquote>");
      expect(single).toContain("quote");

      const nested = markdownToHtml("> outer\n>\n> > inner");
      expect(nested).toContain("<blockquote>");
      // nested <blockquote> tag inside another
      const matches = nested.match(/<blockquote>/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it("renders GFM autolinks", () => {
      const result = markdownToHtml("visit https://example.com today");
      expect(result).toContain('<a href="https://example.com"');
    });

    it("renders images", () => {
      const result = markdownToHtml("![alt text](https://example.com/a.png)");
      expect(result).toContain('<img src="https://example.com/a.png"');
      expect(result).toContain('alt="alt text"');
    });

    it("renders GFM task lists", () => {
      const md = "- [ ] todo\n- [x] done";
      const result = markdownToHtml(md);
      expect(result).toContain('type="checkbox"');
      expect(result).toContain("task-list-item");
      // the completed item should be `checked`
      expect(result).toMatch(/checked[^>]*>\s*done/);
    });

    it("preserves embedded raw HTML blocks", () => {
      const md = '<div class="foo">bar</div>';
      const result = markdownToHtml(md);
      expect(result).toContain('<div class="foo">bar</div>');
    });

    it("treats two-space line endings as hard breaks", () => {
      const result = markdownToHtml("Line 1  \nLine 2");
      expect(result).toContain("<br>");
      expect(result).toContain("Line 1");
      expect(result).toContain("Line 2");
    });

    it("treats single \\n as <br> (remark-breaks)", () => {
      const result = markdownToHtml("alpha\nbeta");
      // one paragraph with a <br> between the two lines
      expect(result).toMatch(/<p>alpha[\s\S]*<br[^>]*>[\s\S]*beta<\/p>/);
    });
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
