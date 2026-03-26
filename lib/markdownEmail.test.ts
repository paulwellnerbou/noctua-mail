import { describe, expect, it } from "bun:test";
import { markdownToEmailHtml } from "./markdownEmail";

describe("markdownToEmailHtml", () => {
  it("renders preview html and inlines package css", async () => {
    const result = await markdownToEmailHtml("# Hello");
    expect(result).toContain("<style data-noctua-markdown-preview");
    expect(result).toContain('class="wmde-markdown wmde-markdown-color');
    expect(result).toContain("<h1");
    expect(result).toContain("Hello");
  });

  it("includes syntax highlighted tokens for code blocks", async () => {
    const result = await markdownToEmailHtml("```js\nconst x = 1;\n```");
    expect(result).toContain('class="language-js');
    expect(result).toContain("<pre><code");
    expect(result).toContain("const");
  });

  it("returns empty string for empty input", async () => {
    expect(await markdownToEmailHtml("")).toBe("");
    expect(await markdownToEmailHtml("   ")).toBe("");
  });
});
