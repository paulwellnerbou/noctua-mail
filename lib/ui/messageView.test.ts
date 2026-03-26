import { describe, expect, it } from "bun:test";
import { hasHtmlContent, hasMeaningfulHtmlText } from "./messageView";

describe("hasMeaningfulHtmlText", () => {
  it("returns true for regular html content", () => {
    expect(hasMeaningfulHtmlText("<p>Hello Simon</p>")).toBe(true);
  });

  it("returns false for apple mail style empty html fragments", () => {
    const html = [
      '<html><body><div><blockquote type="cite"><div><div>',
      '<meta http-equiv="content-type" content="text/html; charset=us-ascii">',
      '<p class="MsoNormal" style="margin:0"></p>',
      "<div><br></div>",
      "</div></div></blockquote></div></body></html>"
    ].join("");

    expect(hasMeaningfulHtmlText(html)).toBe(false);
  });

  it("returns false for image-only html", () => {
    const html = '<div><img src="https://example.com/test.png" alt=""></div>';

    expect(hasHtmlContent(html)).toBe(true);
    expect(hasMeaningfulHtmlText(html)).toBe(false);
  });
});
