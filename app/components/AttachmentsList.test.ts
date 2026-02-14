import { describe, expect, it } from "bun:test";
import { canPreviewAttachment } from "./AttachmentsList";

describe("canPreviewAttachment", () => {
  it("treats octet-stream PDFs as previewable", () => {
    expect(canPreviewAttachment("application/octet-stream", "invoice.pdf")).toBe(true);
  });

  it("does not treat non-PDF octet-stream files as previewable", () => {
    expect(canPreviewAttachment("application/octet-stream", "archive.zip")).toBe(false);
  });
});
