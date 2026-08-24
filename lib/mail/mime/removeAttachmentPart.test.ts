import { describe, expect, it } from "bun:test";
import { simpleParser } from "mailparser";
import { removeAttachmentPartFromRawMessage } from "@/lib/mail/mime/removeAttachmentPart";

// Real IMAP sources are CRLF-delimited; build fixtures that way so the boundary
// matching is exercised the way it runs in production.
const crlf = (lines: string[]) => lines.join("\r\n");

const MIXED_TWO_ATTACHMENTS = crlf([
  "From: sender@example.com",
  "To: receiver@example.com",
  "Subject: Two attachments",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="outer"',
  "",
  "--outer",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hello body",
  "--outer",
  'Content-Type: application/pdf; name="invoice.pdf"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="invoice.pdf"',
  "",
  "SGVsbG8gUERGCg==",
  "--outer",
  'Content-Type: image/png; name="logo.png"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="logo.png"',
  "",
  "iVBORw0KGgo=",
  "--outer--",
  ""
]);

const RELATED_INLINE_IMAGE = crlf([
  "From: sender@example.com",
  "To: receiver@example.com",
  "Subject: Inline signature image",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="mixed"',
  "",
  "--mixed",
  'Content-Type: multipart/related; boundary="rel"',
  "",
  "--rel",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<p>Hi</p><img src="cid:sig@noctua">',
  "--rel",
  "Content-Type: image/png",
  "Content-Transfer-Encoding: base64",
  "Content-ID: <sig@noctua>",
  'Content-Disposition: inline; filename="sig.png"',
  "",
  "iVBORw0KGgoAAAA=",
  "--rel--",
  "--mixed",
  'Content-Type: application/pdf; name="report.pdf"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="report.pdf"',
  "",
  "cmVwb3J0",
  "--mixed--",
  ""
]);

describe("removeAttachmentPartFromRawMessage", () => {
  it("removes a named attachment and keeps the body and sibling attachment", async () => {
    const { raw, removed } = removeAttachmentPartFromRawMessage(MIXED_TWO_ATTACHMENTS, {
      id: "att-1",
      filename: "invoice.pdf",
      contentType: "application/pdf"
    });
    expect(removed).toBe(true);

    const parsed = await simpleParser(raw);
    const names = (parsed.attachments ?? []).map((a) => a.filename);
    expect(names).toEqual(["logo.png"]);
    expect(parsed.text?.trim()).toBe("Hello body");
  });

  it("removes an inline image by content-id, keeping the html part and pdf", async () => {
    const { raw, removed } = removeAttachmentPartFromRawMessage(RELATED_INLINE_IMAGE, {
      id: "att-0",
      filename: "sig.png",
      contentType: "image/png",
      cid: "sig@noctua"
    });
    expect(removed).toBe(true);

    const parsed = await simpleParser(raw);
    const names = (parsed.attachments ?? []).map((a) => a.filename);
    expect(names).toEqual(["report.pdf"]);
    expect(parsed.html || "").toContain("cid:sig@noctua"); // reference remains; caller strips the <img>
    expect(parsed.html || "").toContain("Hi");
  });

  it("selects the right sibling by positional index when names collide", async () => {
    const { raw, removed } = removeAttachmentPartFromRawMessage(MIXED_TWO_ATTACHMENTS, {
      id: "att-1", // second attachment-like leaf
      filename: "logo.png",
      contentType: "image/png"
    });
    expect(removed).toBe(true);
    const parsed = await simpleParser(raw);
    expect((parsed.attachments ?? []).map((a) => a.filename)).toEqual(["invoice.pdf"]);
  });

  it("returns removed=false and the untouched buffer when the target is absent", () => {
    const result = removeAttachmentPartFromRawMessage(MIXED_TWO_ATTACHMENTS, {
      id: "att-9",
      filename: "missing.zip",
      contentType: "application/zip"
    });
    expect(result.removed).toBe(false);
    expect(result.raw.toString("latin1")).toBe(MIXED_TWO_ATTACHMENTS);
  });

  it("leaves a non-multipart message unchanged", () => {
    const plain = crlf([
      "From: a@example.com",
      "Subject: plain",
      "Content-Type: text/plain",
      "",
      "just text",
      ""
    ]);
    const result = removeAttachmentPartFromRawMessage(plain, { id: "att-0", filename: "x" });
    expect(result.removed).toBe(false);
    expect(result.raw.toString("latin1")).toBe(plain);
  });

  it("handles bare-LF sources", async () => {
    const lf = MIXED_TWO_ATTACHMENTS.replace(/\r\n/g, "\n");
    const { raw, removed } = removeAttachmentPartFromRawMessage(lf, {
      id: "att-0",
      filename: "invoice.pdf",
      contentType: "application/pdf"
    });
    expect(removed).toBe(true);
    const parsed = await simpleParser(raw);
    expect((parsed.attachments ?? []).map((a) => a.filename)).toEqual(["logo.png"]);
  });
});
