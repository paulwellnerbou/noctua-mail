import { describe, expect, it } from "bun:test";
import {
  assembleQuotedHtml,
  buildQuotedHtmlPartsFromHtml,
  extractBodyContent,
  extractVisibleHtmlText,
  decodeHtmlEntities,
  ensureHtmlDocumentTitle,
  linkifyHtmlTextNodes,
  sanitizeHtmlForDisplay,
  selectPreferredHtmlDocument,
  shouldShowHtmlViewerFrame,
  stripHtmlToText,
  stripConditionalComments
} from "./html";
import { markdownToEmailHtml } from "./markdownEmail";
import { type DefaultTreeAdapterMap, parseFragment } from "parse5";

type Parse5Node = DefaultTreeAdapterMap["node"];

// "Is the footer still inside the centering cell?" is a question about the tree
// a browser builds from the sanitizer's output, not about tag order in the
// string — an escaped element can still be followed by some other closing tag.
// parse5 answers it directly.
function ancestorTagsOfText(html: string, needle: string) {
  const visit = (node: Parse5Node, trail: string[]): string[] | null => {
    for (const child of "childNodes" in node ? node.childNodes : []) {
      if (child.nodeName === "#text") {
        if ("value" in child && child.value.includes(needle)) return trail;
        continue;
      }
      const align = "attrs" in child ? child.attrs.find((attr) => attr.name === "align") : undefined;
      const label = align ? `${child.nodeName}[align="${align.value}"]` : child.nodeName;
      const found = visit(child, [...trail, label]);
      if (found) return found;
    }
    return null;
  };
  return visit(parseFragment(html), []) ?? [];
}

describe("sanitizeHtmlForDisplay", () => {
  it("strips quoted inline event handlers", () => {
    const out = sanitizeHtmlForDisplay('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert");
  });

  it("strips unquoted inline event handlers (previous sanitizer bypass)", () => {
    const out = sanitizeHtmlForDisplay("<img src=x onerror=alert(1)>");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert");
  });

  it("strips javascript: URLs whether quoted or not", () => {
    const quoted = sanitizeHtmlForDisplay('<a href="javascript:alert(1)">x</a>');
    expect(quoted.toLowerCase()).not.toContain("javascript:");
    const unquoted = sanitizeHtmlForDisplay("<a href=javascript:alert(1)>x</a>");
    expect(unquoted.toLowerCase()).not.toContain("javascript:");
  });

  it("removes <script> tags and inline payloads", () => {
    const out = sanitizeHtmlForDisplay("<p>ok</p><script>alert(1)</script>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("<p>ok</p>");
  });

  it("removes dangerous structural tags (iframe/object/embed/form)", () => {
    const out = sanitizeHtmlForDisplay(
      '<iframe src="javascript:alert(1)"></iframe>' +
        '<object data="evil"></object>' +
        "<embed src=\"evil\">" +
        "<form action=\"http://attacker\"><input></form>"
    );
    expect(out.toLowerCase()).not.toContain("<iframe");
    expect(out.toLowerCase()).not.toContain("<object");
    expect(out.toLowerCase()).not.toContain("<embed");
    expect(out.toLowerCase()).not.toContain("<form");
  });

  it("blocks SVG script-injection vectors", () => {
    const out = sanitizeHtmlForDisplay('<svg><script>alert(1)</script></svg>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });

  it("preserves inline style attributes (HTML email layout depends on them)", () => {
    const out = sanitizeHtmlForDisplay(
      '<table><tr><td style="background-color:#f00;padding:12px;font-family:Arial,sans-serif">x</td></tr></table>'
    );
    expect(out).toContain('style="background-color:#f00;padding:12px;font-family:Arial,sans-serif"');
  });

  it("keeps style attributes with modern CSS sanitize-html's parser might reject", () => {
    const out = sanitizeHtmlForDisplay(
      '<div style="background:linear-gradient(90deg,#f00,#00f);transform:translateX(-50%);--noctua-var:42">x</div>'
    );
    expect(out).toContain("linear-gradient");
    expect(out).toContain("translateX(-50%)");
    expect(out).toContain("--noctua-var:42");
  });

  it("keeps meta, role, xmlns and xml:lang that email templates rely on", () => {
    const out = sanitizeHtmlForDisplay(
      '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en"><head>' +
        '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">' +
        '</head><body><div role="presentation">x</div></body></html>'
    );
    expect(out).toMatch(/<meta\b/i);
    expect(out).toContain('content="text/html; charset=utf-8"');
    expect(out).toContain('role="presentation"');
    expect(out).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(out).toContain('xml:lang="en"');
  });

  it("preserves <style> blocks used by the HTML viewer", () => {
    const out = sanitizeHtmlForDisplay(
      "<html><head><style>.foo{color:red}</style></head><body><p>hi</p></body></html>"
    );
    expect(out).toMatch(/<style\b/i);
    expect(out).toContain(".foo");
    expect(out).toContain("color:red");
  });

  it("preserves the document structure when the input is a full document", () => {
    const out = sanitizeHtmlForDisplay(
      "<html><head><title>t</title></head><body><p>hi</p></body></html>"
    );
    expect(out).toMatch(/<html[\s>]/i);
    expect(out).toMatch(/<body[\s>]/i);
  });

  it("returns a fragment (no auto-wrap) when input has no <html>", () => {
    const out = sanitizeHtmlForDisplay("<p>hi</p>");
    expect(out).not.toMatch(/<html[\s>]/i);
    expect(out).not.toMatch(/<body[\s>]/i);
    expect(out).toContain("<p>hi</p>");
  });

  it("keeps the document skeleton when only a doctype marks the input as one", () => {
    const out = sanitizeHtmlForDisplay("<!doctype html><p>hi</p>");
    expect(out).toMatch(/<html[\s>]/i);
    expect(out).toMatch(/<body[\s>]/i);
    expect(out).toContain("<p>hi</p>");
  });

  it("leaves a fragment opening with <meta> unwrapped", () => {
    // Calendar descriptions and quoted parts arrive as bare fragments; a
    // <meta charset> lead-in must not promote one to a full document.
    const out = sanitizeHtmlForDisplay('<meta charset="utf-8"><div>note</div>');
    expect(out).not.toMatch(/<html[\s>]/i);
    expect(out).not.toMatch(/<body[\s>]/i);
    expect(out).toContain("<div>note</div>");
  });

  it("strips <link> tags (used for stylesheet exfiltration in emails)", () => {
    const out = sanitizeHtmlForDisplay(
      '<html><head><link rel="stylesheet" href="http://attacker/x.css"></head><body>x</body></html>'
    );
    expect(out.toLowerCase()).not.toContain("<link");
  });
});

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

  it("preserves downlevel-hidden !mso content without leaving broken markers", () => {
    const html = [
      "<html><head>",
      '<!--[if !mso]><meta http-equiv="X-UA-Compatible" content="IE=edge" /><![endif]-->',
      "</head><body><div>visible</div></body></html>"
    ].join("");

    expect(stripConditionalComments(html)).toBe(
      '<html><head><meta http-equiv="X-UA-Compatible" content="IE=edge" /></head><body><div>visible</div></body></html>'
    );
  });

  it("keeps closing tags around nested [if true] blocks inside a revealed block", () => {
    // eBay-style: a downlevel-revealed wrapper containing a nested downlevel-hidden block
    // for Outlook's &nbsp; placeholder. The closing </div> sits *between* the inner
    // <![endif]--> and the outer <!--<![endif]-->, and must not be swallowed — otherwise
    // following sections end up nested inside .gutter instead of as its siblings.
    const html = [
      "<!--[if !true]><!-->",
      '<div class="gutter">',
      "<!--[if true]>&#160;<![endif]-->",
      "</div>",
      "<!--<![endif]-->",
      '<div class="next">next</div>'
    ].join("");

    const out = stripConditionalComments(html);
    // The .gutter <div> must close *before* the .next sibling — i.e. </div> sits
    // between them. Asserting both halves separately wouldn't catch a swallowed
    // </div>, because the .next div also contributes its own </div>.
    expect(out).toContain('<div class="gutter"></div><div class="next">next</div>');
    expect(out).not.toContain("[if");
    expect(out).not.toContain("endif");
  });
});

describe("html message regression", () => {
  it("keeps hero content after stripping Patreon-style !mso conditional markup", () => {
    const html = [
      "<!DOCTYPE html>",
      "<html><head>",
      "<title>How to Improvise a Solo - Going Live on Rock Class 101!</title>",
      '<!--[if !mso]><meta http-equiv="X-UA-Compatible" content="IE=edge" /><![endif]-->',
      "</head>",
      '<body id="body" style="background-color: transparent;">',
      '<div><img src="https://example.com/hero.png" width="592" /></div>',
      '<h2><a href="https://example.com/post">How to Improvise a Solo - Going Live on Rock Class 101!</a></h2>',
      "<div>Matt Dahlberg</div>",
      "<p>In this session, you’ll learn what improvising is.</p>",
      "</body></html>"
    ].join("");

    const out = sanitizeHtmlForDisplay(stripConditionalComments(html));

    expect(out).toMatch(/<body[\s>]/i);
    expect(out).toContain("hero.png");
    expect(out).toContain("Matt Dahlberg");
    expect(out).toContain("In this session");
  });

  it("keeps the footer inside the centering cell when a layout table is malformed", () => {
    // XING newsletters open a <tr> straight inside a <td> and then close the
    // row twice. htmlparser2 unwinds the enclosing layout tables on that and
    // drops the end tags left over, which lets everything after the damaged
    // table escape the <td align="center"> and render full-width.
    const html = [
      '<table class="page"><tr><td align="center">',
      '<table class="column" style="max-width:600px;"><tr><td>',
      "<table><tr><td>",
      "<tr><td><table><tr><td>29</td><tr></table></td></tr>",
      "</td></tr></table>",
      "</td></tr></table>",
      '<div class="footer">Example Corp SE, Example Street 1</div>',
      "</td></tr></table>"
    ].join("");

    const out = sanitizeHtmlForDisplay(html);

    expect(out).toContain("Example Corp SE");
    expect(ancestorTagsOfText(out, "Example Corp SE")).toContain('td[align="center"]');
    expect(out.match(/<table/g)?.length).toBe(out.match(/<\/table>/g)?.length);
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

  it("keeps content after a nested second body tag", () => {
    const html = [
      '<html><head></head><body bgcolor="#FFFFFF" style="margin:0">',
      "<table><tr><td>",
      '<body id="body" style="background-color:#FFFFFF">',
      "<img src=\"https://example.com/logo.png\" alt=\"\">",
      "</body>",
      "<div>Terms of service body text</div>",
      "</td></tr></table>",
      "</body></html>"
    ].join("");

    const result = extractBodyContent(html);

    expect(result.body).toContain("Terms of service body text");
    expect(result.bodyAttrs.style).toBe("margin:0");
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

  it("keeps the viewer frame for mails with rich link cards but no body background", () => {
    const html = [
      '<html><body style="overflow-wrap: break-word; -webkit-nbsp-mode: space; line-break: after-white-space;">',
      '<div><a style="border-radius:10px;display:block;overflow:hidden;text-decoration:none;" href="https://example.com/zoom">',
      '<table style="table-layout:fixed;border-collapse:collapse;width:228px;background-color:#E5E6E9;" width="228"><tr><td><img width="228" height="228" src="https://example.com/thumb.png"></td></tr></table>',
      "</a></div>",
      "<div>Hallo Mario,</div>",
      "</body></html>"
    ].join("");

    expect(shouldShowHtmlViewerFrame(html)).toBe(true);
  });

  it("keeps the viewer frame when the body only declares a plain white background", () => {
    const html = [
      '<html><body bgcolor="#ffffff">',
      "<div>Hallo Alex,<br><br>das ist korrekt.</div>",
      "</body></html>"
    ].join("");

    expect(shouldShowHtmlViewerFrame(html)).toBe(true);
  });

  it("keeps the viewer frame for a plain white background declared via style", () => {
    const html = [
      '<html><body style="background-color: #FFFFFF;">',
      "<div>Hallo Alex,</div>",
      "</body></html>"
    ].join("");

    expect(shouldShowHtmlViewerFrame(html)).toBe(true);
  });

  it("keeps the viewer frame for a plain white background marked !important", () => {
    const html = '<html><body style="background-color:#fff!important;"><div>Hi</div></body></html>';

    expect(shouldShowHtmlViewerFrame(html)).toBe(true);
  });

  it("drops the viewer frame when the body declares a non-white background", () => {
    const html = '<html><body bgcolor="#f5f5f5"><div>Hello</div></body></html>';

    expect(shouldShowHtmlViewerFrame(html)).toBe(false);
  });

  it("uses the last background declaration when several cascade in the body style", () => {
    const html =
      '<html><body style="background-color:#fff;background-color:#222"><div>Hello</div></body></html>';

    expect(shouldShowHtmlViewerFrame(html)).toBe(false);
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

  it("keeps body content after a nested second body tag when quoting", () => {
    const html = [
      '<html><body bgcolor="#FFFFFF">',
      "<table><tr><td>",
      '<body id="body"><div>Header logo</div></body>',
      "<div>Original message body text</div>",
      "</td></tr></table>",
      "</body></html>"
    ].join("");

    const parts = buildQuotedHtmlPartsFromHtml(html, "Header", false);

    expect(parts.bodyHtml).toContain("Original message body text");
  });

  it("quotes the real document when two complete html documents are concatenated", () => {
    const html = [
      "<html><head></head><body><div>Original message body text</div></body></html>",
      "<br/>\n",
      "<html><head></head><body><div><div></div></div></body></html>"
    ].join("");

    const parts = buildQuotedHtmlPartsFromHtml(html, "Header", false);

    expect(parts.bodyHtml).toContain("Original message body text");
    expect(parts.bodyHtml).not.toContain("</body>");
    expect(parts.bodyHtml).not.toContain("<html");
  });

  it("keeps the quoted wrapper even when html quoting is disabled", () => {
    const parts = buildQuotedHtmlPartsFromHtml("<p>Quoted</p>", "Header", false);

    const result = assembleQuotedHtml(parts, false);

    expect(result).toContain('<div id="noctua-quoted-html">');
    expect(result).toContain('<div class="noctua-quoted-email-body"><p>Quoted</p></div>');
    expect(result).toContain("<p>Header</p>");
    expect(result).not.toContain("<blockquote");
  });

  it("preserves standard link presentation when quoting markdown-generated html mail", async () => {
    const markdownHtml = await markdownToEmailHtml("[Example](https://example.com)");
    const parts = buildQuotedHtmlPartsFromHtml(markdownHtml, "Header", false);

    const result = assembleQuotedHtml(parts, true);
    const linkRule =
      result.match(
        /#noctua-quoted-html \.noctua-quoted-email-body \.wmde-markdown a\{([^}]*)\}/
      )?.[0] ?? "";

    expect(linkRule).toBe(
      "#noctua-quoted-html .noctua-quoted-email-body .wmde-markdown a{background-color:transparent}"
    );
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
