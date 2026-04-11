import { describe, expect, it } from "bun:test";
import type { Attachment } from "@/lib/data";
import {
  canPreviewAttachment,
  getAttachmentDownloadHref,
  getAttachmentPreviewHref,
  getVisibleAttachments
} from "./AttachmentsList";

function makeAttachment(overrides?: Partial<Attachment>): Attachment {
  return {
    id: "a1",
    filename: "invoice.pdf",
    contentType: "application/pdf",
    size: 2048,
    inline: false,
    ...overrides
  };
}

describe("canPreviewAttachment", () => {
  it("treats octet-stream PDFs as previewable", () => {
    expect(canPreviewAttachment("application/octet-stream", "invoice.pdf")).toBe(true);
  });

  it("does not treat non-PDF octet-stream files as previewable", () => {
    expect(canPreviewAttachment("application/octet-stream", "archive.zip")).toBe(false);
  });
});

describe("getVisibleAttachments", () => {
  it("hides inline images and calendar invites from the generic attachment list", () => {
    const result = getVisibleAttachments([
      makeAttachment({ id: "file" }),
      makeAttachment({ id: "inline", inline: true, contentType: "image/png" }),
      makeAttachment({ id: "invite", filename: "invite.ics", contentType: "text/calendar" })
    ], "<html><body><p>Hello</p></body></html>");

    expect(result.map((attachment) => attachment.id)).toEqual(["file"]);
  });

  it("shows inline images as normal attachments when the message has no html body", () => {
    const result = getVisibleAttachments([
      makeAttachment({ id: "inline", inline: true, contentType: "image/jpeg" })
    ]);

    expect(result.map((attachment) => attachment.id)).toEqual(["inline"]);
  });
});

describe("getAttachmentDownloadHref", () => {
  it("adds an explicit download query parameter for attachment URLs", () => {
    expect(
      getAttachmentDownloadHref(makeAttachment({ url: "/api/accounts/a/messages/m/attachments/att-1" }))
    ).toBe("/api/accounts/a/messages/m/attachments/att-1?download=1");
  });

  it("preserves existing query parameters and hash fragments", () => {
    expect(
      getAttachmentDownloadHref(
        makeAttachment({ url: "/api/file?id=1#preview" })
      )
    ).toBe("/api/file?id=1&download=1#preview");
  });

  it("keeps data URLs unchanged", () => {
    expect(
      getAttachmentDownloadHref(makeAttachment({ dataUrl: "data:text/plain;base64,SGVsbG8=" }))
    ).toBe("data:text/plain;base64,SGVsbG8=");
  });
});

describe("getAttachmentPreviewHref", () => {
  it("returns the attachment URL for previewable files", () => {
    expect(
      getAttachmentPreviewHref(
        makeAttachment({ url: "/api/accounts/a/messages/m/attachments/att-1" })
      )
    ).toBe("/api/accounts/a/messages/m/attachments/att-1");
  });

  it("returns null for non-previewable files", () => {
    expect(
      getAttachmentPreviewHref(
        makeAttachment({
          filename: "archive.zip",
          contentType: "application/zip",
          url: "/api/accounts/a/messages/m/attachments/att-1"
        })
      )
    ).toBeNull();
  });
});
