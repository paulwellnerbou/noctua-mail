import { describe, expect, it } from "bun:test";
import { restoreInlineAttachmentDataUrls } from "./useComposeHandlers";

describe("restoreInlineAttachmentDataUrls", () => {
  it("replaces inline attachment URLs with hydrated data URLs", () => {
    const html =
      '<p>Hello</p><img src="/api/accounts/acc-1/messages/draft-1/attachments/att-inline">';
    const output = restoreInlineAttachmentDataUrls(html, [
      {
        id: "att-inline",
        filename: "logo.png",
        contentType: "image/png",
        size: 123,
        inline: true,
        url: "/api/accounts/acc-1/messages/draft-1/attachments/att-inline",
        dataUrl: "data:image/png;base64,AAAA"
      }
    ]);

    expect(output).toContain("data:image/png;base64,AAAA");
    expect(output).not.toContain("/api/accounts/acc-1/messages/draft-1/attachments/att-inline");
  });

  it("ignores non-inline attachments", () => {
    const html = '<a href="/api/accounts/acc-1/messages/draft-1/attachments/att-1">file</a>';
    const output = restoreInlineAttachmentDataUrls(html, [
      {
        id: "att-1",
        filename: "file.txt",
        contentType: "text/plain",
        size: 12,
        inline: false,
        url: "/api/accounts/acc-1/messages/draft-1/attachments/att-1",
        dataUrl: "data:text/plain;base64,SGVsbG8="
      }
    ]);

    expect(output).toBe(html);
  });
});
