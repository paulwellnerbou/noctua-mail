import { describe, expect, it } from "bun:test";
import {
  extractAttachmentBufferFromSource,
  mergeAttachmentMetadataFromParsedAttachments
} from "@/lib/mail/attachmentFromSource";

const SAMPLE_EML = `From: sender@example.com
To: receiver@example.com
Subject: Attachment extraction test
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="outer"

--outer
Content-Type: text/plain; charset=utf-8

Hello
--outer
Content-Type: application/pdf; name="invoice.pdf"
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="invoice.pdf"

SGVsbG8gUERGCg==
--outer
Content-Type: image/png; name="logo.png"
Content-Transfer-Encoding: base64
Content-Disposition: inline; filename="logo.png"
Content-ID: <logo-cid@example.com>

iVBORw0KGgo=
--outer--
`;

describe("extractAttachmentBufferFromSource", () => {
  it("extracts by attachment index from id suffix", async () => {
    const buffer = await extractAttachmentBufferFromSource(SAMPLE_EML, {
      id: "att-acc-123-0",
      filename: "invoice.pdf",
      contentType: "application/pdf",
      cid: undefined
    });
    expect(buffer).not.toBeNull();
    expect(buffer?.toString("utf8")).toBe("Hello PDF\n");
  });

  it("falls back to metadata matching when index is out of range", async () => {
    const buffer = await extractAttachmentBufferFromSource(SAMPLE_EML, {
      id: "att-acc-123-99",
      filename: "invoice.pdf",
      contentType: "application/pdf; name=invoice.pdf",
      cid: undefined
    });
    expect(buffer).not.toBeNull();
    expect(buffer?.toString("utf8")).toBe("Hello PDF\n");
  });

  it("can extract inline parts by cid", async () => {
    const buffer = await extractAttachmentBufferFromSource(SAMPLE_EML, {
      id: "att-acc-123-99",
      filename: undefined,
      contentType: undefined,
      cid: "logo-cid@example.com"
    });
    expect(buffer).not.toBeNull();
    expect(buffer?.toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("prefers cid metadata over index when ids are shifted", async () => {
    const buffer = await extractAttachmentBufferFromSource(SAMPLE_EML, {
      id: "att-acc-123-0",
      filename: "mismatch-name.bin",
      contentType: "application/octet-stream",
      cid: "logo-cid@example.com"
    });
    expect(buffer).not.toBeNull();
    expect(buffer?.toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("returns null when no attachment can be matched", async () => {
    const buffer = await extractAttachmentBufferFromSource(SAMPLE_EML, {
      id: "att-acc-123-99",
      filename: "missing.bin",
      contentType: "application/octet-stream",
      cid: undefined
    });
    expect(buffer).toBeNull();
  });

  it("prefers source attachment cid metadata over mismatched imap cid metadata", () => {
    const filename = "E-Mail_Banner-Hoer-auf-dich(1)_bce67f06-2eb9-4fb5-b7a8-2659410eb50d.jpg";
    const cid = filename;
    const merged = mergeAttachmentMetadataFromParsedAttachments(
      [
        {
          id: "att-acc-123-1",
          filename,
          contentType: "image/jpeg",
          size: 183229,
          inline: true,
          cid: "E-Mail_Banner-Hoer-auf-dich_bce67f06-2eb9-4fb5-b7a8-2659410eb50d.jpg"
        }
      ],
      [
        {
          filename,
          contentType: "image/jpeg",
          contentId: `<${cid}>`,
          content: Buffer.from("x")
        }
      ]
    );

    expect(merged[0]?.cid).toBe(cid);
    expect(merged[0]?.filename).toBe(filename);
  });
});
