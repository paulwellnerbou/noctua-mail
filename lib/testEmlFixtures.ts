/**
 * Raw RFC 822 message with one regular and one inline attachment, for tests
 * that exercise attachment extraction from a cached source.
 */
export const ATTACHMENT_EML = `From: sender@example.test
To: receiver@example.test
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
Content-ID: <logo-cid@example.test>

iVBORw0KGgo=
--outer--
`;

/** Decoded bytes of the `invoice.pdf` part in {@link ATTACHMENT_EML}. */
export const ATTACHMENT_EML_INVOICE_TEXT = "Hello PDF\n";

const BINARY_ATTACHMENT_EML_HEAD = `From: sender@example.test
To: receiver@example.test
Subject: Binary attachment test
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="bin"

--bin
Content-Type: text/plain; charset=utf-8

Hello
--bin
Content-Type: application/octet-stream; name="blob.bin"
Content-Transfer-Encoding: binary
Content-Disposition: attachment; filename="blob.bin"

`;

/**
 * Payload of the `blob.bin` part in {@link BINARY_ATTACHMENT_EML}: bytes that
 * are not valid UTF-8, so a source read as text would alter them.
 */
export const BINARY_ATTACHMENT_EML_BYTES = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x7f, 0xc3]);

/** Raw RFC 822 message whose attachment is sent with `Content-Transfer-Encoding: binary`. */
export const BINARY_ATTACHMENT_EML = Buffer.concat([
  Buffer.from(BINARY_ATTACHMENT_EML_HEAD, "utf8"),
  BINARY_ATTACHMENT_EML_BYTES,
  Buffer.from("\n--bin--\n", "utf8")
]);
