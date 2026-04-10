import { describe, expect, it } from "bun:test";
import {
  appendUnreferencedInlineImages,
  replaceInlineImageSources,
  stripRedundantInlineImageFallbacks
} from "./html";

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

  it("replaces cid image references using filename fallback when cid metadata is wrong", () => {
    const url = "/api/accounts/a/messages/m/attachments/1";
    const input =
      '<html><body><img src="cid:E-Mail_Banner-Hoer-auf-dich(1)_bce67f06-2eb9-4fb5-b7a8-2659410eb50d.jpg"></body></html>';
    const output = replaceInlineImageSources(input, [
      {
        inline: true,
        contentType: "image/jpeg",
        filename: "E-Mail_Banner-Hoer-auf-dich(1)_bce67f06-2eb9-4fb5-b7a8-2659410eb50d.jpg",
        cid: "E-Mail_Banner-Hoer-auf-dich_bce67f06-2eb9-4fb5-b7a8-2659410eb50d.jpg",
        url
      }
    ]);

    expect(output).toContain(`src="${url}"`);
  });

  it("does not corrupt cid references that share prefixes", () => {
    const output = replaceInlineImageSources(
      '<html><body><img src="cid:logo"><img src="cid:logo2"></body></html>',
      [
        {
          inline: true,
          contentType: "image/png",
          filename: "logo.png",
          cid: "logo",
          url: "/api/accounts/a/messages/m/attachments/1"
        },
        {
          inline: true,
          contentType: "image/png",
          filename: "logo2.png",
          cid: "logo2",
          url: "/api/accounts/a/messages/m/attachments/2"
        }
      ]
    );

    expect(output).toContain('src="/api/accounts/a/messages/m/attachments/1"');
    expect(output).toContain('src="/api/accounts/a/messages/m/attachments/2"');
    expect(output).not.toContain('/attachments/12');
  });

  it("does not append when a matching cid reference is already present", () => {
    const input =
      '<html><body><img src="cid:E-Mail_Banner-Hoer-auf-dich(1)_bce67f06-2eb9-4fb5-b7a8-2659410eb50d.jpg"></body></html>';
    const output = appendUnreferencedInlineImages(input, [
      {
        inline: true,
        contentType: "image/jpeg",
        filename: "E-Mail_Banner-Hoer-auf-dich(1)_bce67f06-2eb9-4fb5-b7a8-2659410eb50d.jpg",
        cid: "E-Mail_Banner-Hoer-auf-dich_bce67f06-2eb9-4fb5-b7a8-2659410eb50d.jpg",
        url: "/api/accounts/a/messages/m/attachments/1"
      }
    ]);

    expect(output).toBe(input);
  });

  it("strips auto-appended fallback snippets when the same image is already present", () => {
    const url = "/api/accounts/a/messages/m/attachments/1";
    const input = `<html><body><img src="${url}" alt="primary"><div data-noctua-inline-images="1"><div data-noctua-inline-image="1" style="margin:12px 0;"><img src="${url}" alt="E-Mail_Banner-Hoer-auf-dich(1)_bce67f06-2eb9-4fb5-b7a8-2659410eb50d.jpg" loading="lazy" decoding="async" style="max-width:100%;height:auto;"></div></div></body></html>`;
    const output = stripRedundantInlineImageFallbacks(input, [
      {
        inline: true,
        contentType: "image/jpeg",
        filename: "E-Mail_Banner-Hoer-auf-dich(1)_bce67f06-2eb9-4fb5-b7a8-2659410eb50d.jpg",
        url
      }
    ]);

    expect(output).toBe('<html><body><img src="/api/accounts/a/messages/m/attachments/1" alt="primary"></body></html>');
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
