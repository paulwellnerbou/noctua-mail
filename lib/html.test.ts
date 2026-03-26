import { describe, expect, it } from "bun:test";
import {
  extractBodyContent,
  extractVisibleHtmlText,
  decodeHtmlEntities,
  ensureHtmlDocumentTitle,
  linkifyHtmlTextNodes,
  selectPreferredHtmlDocument,
  stripHtmlToText,
  stripConditionalComments
} from "./html";

describe("decodeHtmlEntities", () => {
  it("decodes named and angle-bracket entities", () => {
    expect(
      decodeHtmlEntities("&quot;Paul Wellner Bou&quot; &lt;paul@example.com&gt;")
    ).toBe('"Paul Wellner Bou" <paul@example.com>');
  });
});

describe("stripHtmlToText", () => {
  it("decodes html entities after stripping tags", () => {
    expect(
      stripHtmlToText(
        "<p>On 2026-03-25 10:22, &quot;Paul Wellner Bou&quot; &lt;paul@example.com&gt; wrote:</p>"
      )
    ).toBe('On 2026-03-25 10:22, "Paul Wellner Bou" <paul@example.com> wrote:');
  });
});

describe("linkifyHtmlTextNodes", () => {
  it("linkifies plain urls inside html text nodes", () => {
    const html = [
      "<span><span>Daily sync.</span></span>",
      "Join Microsoft Teams Meeting",
      "https://teams.microsoft.com/l/meetup-",
      "join/19%3ameeting_demo%40thread.v2/0?context=%7b%22Tid%22%3a%22tenant%22%7d"
    ].join("\n");

    const result = linkifyHtmlTextNodes(html);

    expect(result).toContain(
      '<a href="https://teams.microsoft.com/l/meetup-join/19%3ameeting_demo%40thread.v2/0?context=%7b%22Tid%22%3a%22tenant%22%7d" target="_blank" rel="noreferrer noopener">https://teams.microsoft.com/l/meetup-join/19%3ameeting_demo%40thread.v2/0?context=%7b%22Tid%22%3a%22tenant%22%7d</a>'
    );
  });

  it("does not wrap urls that are already inside anchor tags", () => {
    const html = '<p><a href="https://example.com">https://example.com</a></p>';

    expect(linkifyHtmlTextNodes(html)).toBe(html);
  });

  it("does not absorb text after blank lines into the link", () => {
    const html =
      "<span>Learn more about Meet at: https://support.google.com/a/users/answer/9282720\n\nPlease do not edit this section.</span>";

    const result = linkifyHtmlTextNodes(html);

    expect(result).toContain(
      '<a href="https://support.google.com/a/users/answer/9282720" target="_blank" rel="noreferrer noopener">https://support.google.com/a/users/answer/9282720</a>'
    );
    expect(result).toContain("</a>\n\nPlease do not edit this section.");
    expect(result).not.toContain("9282720Please");
  });
});

describe("stripConditionalComments", () => {
  it("preserves content from downlevel-revealed conditional blocks", () => {
    const html = [
      '<div class="outer">',
      "<!--[if !true]><!-->",
      '<div class="kept">visible content</div>',
      "<!--<![endif]-->",
      "</div>"
    ].join("");

    expect(stripConditionalComments(html)).toBe(
      '<div class="outer"><div class="kept">visible content</div></div>'
    );
  });

  it("removes content from Outlook-only conditional blocks", () => {
    const html = [
      '<div class="outer">',
      "<!--[if true]>",
      '<table class="outlook-only"><tr><td>fallback</td></tr></table>',
      "<![endif]-->",
      '<div class="kept">visible content</div>',
      "</div>"
    ].join("");

    expect(stripConditionalComments(html)).toBe(
      '<div class="outer"><div class="kept">visible content</div></div>'
    );
  });

  it("preserves revealed !mso content without swallowing following visible markup", () => {
    const html = [
      '<div class="outer">',
      "<!--[if !mso]> <!---->",
      '<img class=\"tracking\" src=\"https://example.com/pixel.png\">',
      "<!-- <![endif]-->",
      '<div class="hero">hero</div>',
      "<!--[if mso]><table class=\"outlook-only\"><tr><td>fallback</td></tr></table><![endif]-->",
      '<div class="footer">footer</div>',
      "</div>"
    ].join("");

    expect(stripConditionalComments(html)).toBe(
      '<div class="outer"><img class="tracking" src="https://example.com/pixel.png"><div class="hero">hero</div><div class="footer">footer</div></div>'
    );
  });
});

describe("selectPreferredHtmlDocument", () => {
  it("prefers the html document with meaningful visible text", () => {
    const meaningful = [
      "<html><head><title>real</title></head><body>",
      "<div>Liebe Elternbeiräte, hier steht der eigentliche Inhalt.</div>",
      "</body></html>"
    ].join("");
    const empty = [
      "<html><head><title>empty</title></head><body>",
      '<div><blockquote type="cite"><div></div></blockquote></div><br>',
      "</body></html>"
    ].join("");

    const selected = selectPreferredHtmlDocument(`${meaningful}${empty}`);

    expect(selected).toContain("Liebe Elternbeiräte");
    expect(extractVisibleHtmlText(selected)).toContain("Liebe Elternbeiräte");
  });

  it("does not split a single html document that contains literal html markup in its content", () => {
    const html = [
      "<!doctype html>",
      "<html><body>",
      "<div>Header</div>",
      "<p><html><head></head><body><a href=\"https://example.com\">literal snippet</a></body></html></p>",
      "<div>Footer</div>",
      "</body></html>"
    ].join("");

    const selected = selectPreferredHtmlDocument(html);

    expect(selected).toBe(html);
    expect(extractVisibleHtmlText(selected)).toContain("Header");
    expect(extractVisibleHtmlText(selected)).toContain("Footer");
  });
});

describe("extractBodyContent", () => {
  it("extracts the body from the preferred html document in concatenated html", () => {
    const meaningful = [
      '<html><head><style>.x{color:red}</style></head><body class="mail-body" style="font-size:14px">',
      "<div>Visible body</div>",
      "</body></html>"
    ].join("");
    const empty = "<html><body><div><br></div></body></html>";

    const result = extractBodyContent(`${meaningful}${empty}`);

    expect(result.body).toContain("Visible body");
    expect(result.body).not.toContain("<div><br></div>");
    expect(result.bodyAttrs.className).toBe("mail-body");
    expect(result.bodyAttrs.style).toBe("font-size:14px");
    expect(result.styles).toEqual(["<style>.x{color:red}</style>"]);
  });
});

describe("ensureHtmlDocumentTitle", () => {
  it("wraps html fragments in a document with the provided title", () => {
    const result = ensureHtmlDocumentTitle("<p>Hello</p>", "Subject - Noctua Mail");

    expect(result).toContain("<title>Subject - Noctua Mail</title>");
    expect(result).toContain("<body>");
    expect(result).toContain("<p>Hello</p>");
  });

  it("replaces an existing title in full html documents", () => {
    const html = [
      "<!doctype html>",
      "<html>",
      "<head><title>Old title</title></head>",
      "<body><p>Hello</p></body>",
      "</html>"
    ].join("");

    const result = ensureHtmlDocumentTitle(html, "Subject - Noctua Mail");

    expect(result).toContain("<title>Subject - Noctua Mail</title>");
    expect(result).not.toContain("<title>Old title</title>");
  });

  it("adds a title when the full html document has no head", () => {
    const html = "<html><body><p>Hello</p></body></html>";

    const result = ensureHtmlDocumentTitle(html, "Subject - Noctua Mail");

    expect(result).toContain("<head><title>Subject - Noctua Mail</title></head>");
    expect(result).toContain("<body><p>Hello</p></body>");
  });
});
