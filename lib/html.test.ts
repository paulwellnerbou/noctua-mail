import { describe, expect, it } from "bun:test";
import {
  assembleQuotedHtml,
  buildQuotedHtmlPartsFromHtml,
  extractBodyContent,
  extractVisibleHtmlText,
  decodeHtmlEntities,
  ensureHtmlDocumentTitle,
  linkifyHtmlTextNodes,
  selectPreferredHtmlDocument,
  shouldShowHtmlViewerFrame,
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
  it("falls back to a later html document when earlier ones are not meaningful", () => {
    const empty = [
      "<html><head><title>empty</title></head><body>",
      '<div><blockquote type="cite"><div></div></blockquote></div><br>',
      "</body></html>"
    ].join("");
    const meaningful = [
      "<html><head><title>real</title></head><body>",
      "<div>Liebe Empfänger, hier steht der eigentliche Inhalt.</div>",
      "</body></html>"
    ].join("");

    const selected = selectPreferredHtmlDocument(`${empty}${meaningful}`);

    expect(selected).toContain("Liebe Empfänger");
    expect(extractVisibleHtmlText(selected)).toContain("Liebe Empfänger");
  });

  it("prefers the html document with meaningful visible text", () => {
    const meaningful = [
      "<html><head><title>real</title></head><body>",
      "<div>Liebe Empfänger, hier steht der eigentliche Inhalt.</div>",
      "</body></html>"
    ].join("");
    const empty = [
      "<html><head><title>empty</title></head><body>",
      '<div><blockquote type="cite"><div></div></blockquote></div><br>',
      "</body></html>"
    ].join("");

    const selected = selectPreferredHtmlDocument(`${meaningful}${empty}`);

    expect(selected).toContain("Liebe Empfänger");
    expect(extractVisibleHtmlText(selected)).toContain("Liebe Empfänger");
  });

  it("keeps the first meaningful html document when a later document is only quoted content", () => {
    const reply = [
      "<html><head><title>reply</title></head><body>",
      "<div>Lieber Paul,</div>",
      "<div>ich habe deine Mail eben erst gesehen.</div>",
      "</body></html>"
    ].join("");
    const quoted = [
      "<html><head><title>quoted</title></head><body>",
      '<blockquote type="cite"><div>Am 01.04.2026 um 12:17 schrieb Paul Wellner Bou:</div>',
      "<div>Hallo Jule, das ist die vorherige Nachricht.</div></blockquote>",
      "</body></html>"
    ].join("");

    const selected = selectPreferredHtmlDocument(`${reply}<br/>${quoted}`);

    expect(selected).toContain("ich habe deine Mail eben erst gesehen");
    expect(selected).not.toContain("Am 01.04.2026 um 12:17 schrieb");
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

  it("concatenates later html documents after the first meaningful html body", () => {
    const reply = [
      '<html><head><style>.x{color:red}</style></head><body class="mail-body" style="font-size:14px">',
      "<div>Visible reply</div>",
      "</body></html>"
    ].join("");
    const quoted = [
      "<html><body>",
      '<blockquote type="cite"><div>Am 01.04.2026 um 12:17 schrieb Paul:</div><div>Earlier message</div></blockquote>',
      "</body></html>"
    ].join("");

    const result = extractBodyContent(`${reply}<br/>${quoted}`);

    expect(result.body).toContain("Visible reply");
    expect(result.body).toContain("Earlier message");
    expect(result.bodyAttrs.className).toBe("mail-body");
    expect(result.bodyAttrs.style).toBe("font-size:14px");
    expect(result.styles).toEqual(["<style>.x{color:red}</style>"]);
  });
});

describe("shouldShowHtmlViewerFrame", () => {
  it("keeps the viewer frame for simple html mails", () => {
    const html = [
      "<html><body>",
      "<div>Hallo,</div>",
      "<br>",
      "<div><p>Der vorgemerkte Titel ist nun verfugbar.</p></div>",
      '<div><a href="https://example.com/item">https://example.com/item</a></div>',
      "</body></html>"
    ].join("");

    expect(shouldShowHtmlViewerFrame(html)).toBe(true);
  });

  it("keeps the viewer frame for simple mails that only constrain width", () => {
    const html = [
      "<html><body>",
      `<div style="max-width: 1024px; color: #242424; font-family:'Segoe UI', Arial, sans-serif">`,
      '<div style="margin-bottom:24px;overflow:hidden;white-space:nowrap;">________________________________</div>',
      '<div style="margin-bottom:12px;"><span style="font-size:20px;font-weight:600">Microsoft Teams-Besprechung</span></div>',
      '<div style="margin-bottom:6px;overflow-wrap:break-word;"><a href="https://example.com/meet">https://example.com/meet</a></div>',
      "</div>",
      "</body></html>"
    ].join("");

    expect(shouldShowHtmlViewerFrame(html)).toBe(true);
  });

  it("drops the viewer frame for mails with their own outer card layout", () => {
    const html = [
      '<html><body bgcolor="#f5f5f5" style="margin:0;padding:0">',
      '<table width="100%" cellspacing="0" cellpadding="0">',
      '<tr><td style="padding:27px 20px 40px 20px;background-color:#f5f5f5;max-width:700px">',
      '<table width="700" align="center" style="margin:0 auto;border:1px solid #d2d2d2;border-radius:5px">',
      '<tr><td bgcolor="#ffffff" style="padding:20px 50px 40px">Hello Paul</td></tr>',
      "</table>",
      "</td></tr>",
      "</table>",
      "</body></html>"
    ].join("");

    expect(shouldShowHtmlViewerFrame(html)).toBe(false);
  });
});

describe("assembleQuotedHtml", () => {
  it("scopes quoted email styles to the quoted email body only", () => {
    const parts = buildQuotedHtmlPartsFromHtml(
      [
        "<style>",
        "body,table,td,a{color:red}",
        ".wrapper{margin:0 auto}",
        "</style>",
        '<table id="body"><tr><td><a href="https://example.com">Quoted</a></td></tr></table>'
      ].join(""),
      "On Mon, Alice wrote:",
      false
    );

    const result = assembleQuotedHtml(parts, true);

    expect(result).toContain('<div id="noctua-quoted-html">');
    expect(result).toContain('<p>On Mon, Alice wrote:</p><blockquote');
    expect(result).toContain('<div class="noctua-quoted-email-body">');
    expect(result).toContain("#noctua-quoted-html .noctua-quoted-email-body, #noctua-quoted-html .noctua-quoted-email-body table, #noctua-quoted-html .noctua-quoted-email-body td, #noctua-quoted-html .noctua-quoted-email-body a{color:red}");
    expect(result).toContain("#noctua-quoted-html .noctua-quoted-email-body .wrapper{margin:0 auto}");
    expect(result).not.toContain("body,table,td,a{color:red}");
  });

  it("scopes selectors inside media queries but leaves keyframes untouched", () => {
    const parts = buildQuotedHtmlPartsFromHtml(
      [
        "<style>",
        "@media only screen and (max-width: 639px){body,#body{min-width:320px}.wrapper td{padding:0}}",
        "@keyframes fade{from{opacity:0}to{opacity:1}}",
        "</style>",
        '<table id="body" class="wrapper"><tr><td>Quoted</td></tr></table>'
      ].join(""),
      "Header",
      false
    );

    const result = assembleQuotedHtml(parts, true);

    expect(result).toContain(
      "@media only screen and (max-width: 639px){#noctua-quoted-html .noctua-quoted-email-body, #noctua-quoted-html .noctua-quoted-email-body #body{min-width:320px}#noctua-quoted-html .noctua-quoted-email-body .wrapper td{padding:0}}"
    );
    expect(result).toContain("@keyframes fade{from{opacity:0}to{opacity:1}}");
  });

  it("keeps the quoted wrapper even when html quoting is disabled", () => {
    const parts = buildQuotedHtmlPartsFromHtml("<p>Quoted</p>", "Header", false);

    const result = assembleQuotedHtml(parts, false);

    expect(result).toContain('<div id="noctua-quoted-html">');
    expect(result).toContain('<div class="noctua-quoted-email-body"><p>Quoted</p></div>');
    expect(result).toContain("<p>Header</p>");
    expect(result).not.toContain("<blockquote");
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
