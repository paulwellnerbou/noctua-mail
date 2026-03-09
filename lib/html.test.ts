import { describe, expect, it } from "bun:test";
import { linkifyHtmlTextNodes } from "./html";

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
