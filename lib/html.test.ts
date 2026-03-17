import { describe, expect, it } from "bun:test";
import {
  ensureHtmlDocumentTitle,
  linkifyHtmlTextNodes,
  stripConditionalComments
} from "./html";

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
