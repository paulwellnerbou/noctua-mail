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
