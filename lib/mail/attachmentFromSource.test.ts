import { describe, expect, it } from "bun:test";
import {
  extractAttachmentBufferFromSource,
  extractIcsSourceFromEmailSource,
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

const DUPLICATE_NAME_EML = `From: sender@example.com
To: receiver@example.com
Subject: Duplicate attachment names
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="dup"

--dup
Content-Type: text/plain; charset=utf-8

Hello
--dup
Content-Type: image/jpeg; name="image0.jpeg"
Content-Transfer-Encoding: base64
Content-Disposition: inline; filename="image0.jpeg"

RklSU1Q=
--dup
Content-Type: image/jpeg; name="image0.jpeg"
Content-Transfer-Encoding: base64
Content-Disposition: inline; filename="image0.jpeg"

U0VDT05E
--dup--
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

  it("uses the attachment index when duplicate filenames share the same content type", async () => {
    const first = await extractAttachmentBufferFromSource(DUPLICATE_NAME_EML, {
      id: "att-acc-123-0",
      filename: "image0.jpeg",
      contentType: "image/jpeg",
      cid: undefined
    });
    const second = await extractAttachmentBufferFromSource(DUPLICATE_NAME_EML, {
      id: "att-acc-123-1",
      filename: "image0.jpeg",
      contentType: "image/jpeg",
      cid: undefined
    });

    expect(first?.toString("utf8")).toBe("FIRST");
    expect(second?.toString("utf8")).toBe("SECOND");
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

describe("extractIcsSourceFromEmailSource", () => {
  it("decodes a quoted-printable text/calendar inline part", async () => {
    const email = [
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="b"',
      "",
      "--b",
      'Content-Type: text/calendar; charset="UTF-8"; method=REQUEST',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:qp@example.test",
      "DTSTART;TZID=3DEurope/Berlin:20260601T160000",
      "RRULE:FREQ=3DWEEKLY;BYDAY=3DMO",
      "SUMMARY:Weekly QP=20",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
      "--b--"
    ].join("\r\n");

    const ics = await extractIcsSourceFromEmailSource(email);
    expect(ics).not.toBeNull();
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
    expect(ics).toContain("DTSTART;TZID=Europe/Berlin:20260601T160000");
    expect(ics).toContain("SUMMARY:Weekly QP ");
    expect(ics).not.toContain("=3D");
  });

  it("decodes a base64 application/ics attachment", async () => {
    const cleanIcs = [
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:b64@example.test",
      "DTSTART:20260601T140000Z",
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "SUMMARY:Weekly base64",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n");
    const email = [
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="b"',
      "",
      "--b",
      "Content-Type: text/plain",
      "",
      "Body",
      "--b",
      'Content-Type: application/ics; name="invite.ics"',
      'Content-Disposition: attachment; filename="invite.ics"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(cleanIcs).toString("base64"),
      "",
      "--b--"
    ].join("\r\n");

    const ics = await extractIcsSourceFromEmailSource(email);
    expect(ics).not.toBeNull();
    expect(ics).toContain("UID:b64@example.test");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO");
  });

  it("returns the input unchanged when it already starts with BEGIN:VCALENDAR", async () => {
    const bareIcs = "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR\r\n";
    const ics = await extractIcsSourceFromEmailSource(bareIcs);
    expect(ics).toBe(bareIcs);
  });

  it("returns null for an email with no calendar attachment", async () => {
    const email = [
      "MIME-Version: 1.0",
      "Content-Type: text/plain",
      "",
      "Just a regular email"
    ].join("\r\n");

    const ics = await extractIcsSourceFromEmailSource(email);
    expect(ics).toBeNull();
  });
});
