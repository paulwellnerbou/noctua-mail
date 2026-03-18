import { describe, expect, it } from "bun:test";
import { appendUnreferencedInlineImages } from "./html";

describe("appendUnreferencedInlineImages", () => {
  it("appends unreferenced inline raster images into the html body", () => {
    const input = "<html><body><p>Hello</p></body></html>";
    const output = appendUnreferencedInlineImages(input, [
      {
        inline: true,
        contentType: "image/webp",
        filename: "giphy.webp",
        url: "/api/accounts/a/messages/m/attachments/1"
      }
    ]);

    expect(output).toContain('data-noctua-inline-images="1"');
    expect(output).toContain('data-noctua-inline-image="1"');
    expect(output).toContain('alt="giphy.webp"');
    expect(output).toContain("/attachments/1");
    expect(output).toContain("</body>");
  });

  it("does not append when the inline image url is already referenced", () => {
    const url = "/api/accounts/a/messages/m/attachments/1";
    const input = `<html><body><img src="${url}" alt="already present"></body></html>`;
    const output = appendUnreferencedInlineImages(input, [
      {
        inline: true,
        contentType: "image/gif",
        filename: "giphy.gif",
        url
      }
    ]);

    expect(output).toBe(input);
  });

  it("ignores non-inline, non-image, and svg attachments", () => {
    const input = "<html><body><p>Hello</p></body></html>";
    const output = appendUnreferencedInlineImages(input, [
      {
        inline: false,
        contentType: "image/webp",
        filename: "not-inline.webp",
        url: "/api/attachment?x=1"
      },
      {
        inline: true,
        contentType: "application/pdf",
        filename: "doc.pdf",
        url: "/api/attachment?x=2"
      },
      {
        inline: true,
        contentType: "image/svg+xml",
        filename: "icon.svg",
        url: "/api/attachment?x=3"
      }
    ]);

    expect(output).toBe(input);
  });
});
