import { describe, expect, test } from "bun:test";
import { stripBccHeader } from "./stripBccHeader";

const CRLF = "\r\n";

function join(lines: string[]): string {
  return lines.join(CRLF);
}

describe("stripBccHeader", () => {
  test("no-op when there is no Bcc header", () => {
    const raw = join([
      "From: alice@example.com",
      "To: bob@example.com",
      "Subject: hello",
      "",
      "hi"
    ]);
    expect(stripBccHeader(raw)).toBe(raw);
  });

  test("removes a single-line Bcc header and its terminating CRLF", () => {
    const before = join([
      "From: alice@example.com",
      "To: bob@example.com",
      "Bcc: eve@example.com",
      "Subject: hello",
      "",
      "hi"
    ]);
    const after = join([
      "From: alice@example.com",
      "To: bob@example.com",
      "Subject: hello",
      "",
      "hi"
    ]);
    expect(stripBccHeader(before)).toBe(after);
  });

  test("removes Bcc when it's the last header before the blank line", () => {
    const before = join([
      "From: alice@example.com",
      "To: bob@example.com",
      "Bcc: eve@example.com",
      "",
      "hi"
    ]);
    const after = join([
      "From: alice@example.com",
      "To: bob@example.com",
      "",
      "hi"
    ]);
    expect(stripBccHeader(before)).toBe(after);
  });

  test("removes a Bcc header with folded continuation lines (RFC 5322 folding)", () => {
    const before =
      "From: alice@example.com" + CRLF +
      "Bcc: first@example.com," + CRLF +
      " second@example.com," + CRLF +
      "\tthird@example.com" + CRLF +
      "Subject: hello" + CRLF +
      CRLF +
      "body";
    const after =
      "From: alice@example.com" + CRLF +
      "Subject: hello" + CRLF +
      CRLF +
      "body";
    expect(stripBccHeader(before)).toBe(after);
  });

  test("case-insensitive header-name match", () => {
    const before = join([
      "From: a@x.com",
      "BCC: e@x.com",
      "",
      "body"
    ]);
    expect(stripBccHeader(before)).toBe(join(["From: a@x.com", "", "body"]));
  });

  test("leaves 'Bcc:'-shaped text inside the body alone", () => {
    const before = join([
      "From: alice@example.com",
      "Subject: quoting an old message",
      "",
      "> Bcc: this-is-body-not-header@example.com",
      "> still body"
    ]);
    expect(stripBccHeader(before)).toBe(before);
  });

  test("tolerates LF-only line endings", () => {
    const before = [
      "From: alice@example.com",
      "Bcc: eve@example.com",
      "Subject: hi",
      "",
      "body"
    ].join("\n");
    const after = [
      "From: alice@example.com",
      "Subject: hi",
      "",
      "body"
    ].join("\n");
    expect(stripBccHeader(before)).toBe(after);
  });

  test("Buffer input → Buffer output (round-trip preserves body bytes exactly)", () => {
    // Binary-ish body content; non-ASCII bytes must survive.
    const bodyBytes = Buffer.from([0xff, 0x00, 0xfe, 0x7f, 0x80, 0x81, 0x82]);
    const headers = "From: a@x.com\r\nBcc: b@x.com\r\nSubject: binary\r\n\r\n";
    const raw = Buffer.concat([Buffer.from(headers, "latin1"), bodyBytes]);

    const result = stripBccHeader(raw);
    expect(Buffer.isBuffer(result)).toBe(true);

    const expectedHeaders = "From: a@x.com\r\nSubject: binary\r\n\r\n";
    const expected = Buffer.concat([Buffer.from(expectedHeaders, "latin1"), bodyBytes]);
    expect((result as Buffer).equals(expected)).toBe(true);
  });

  test("raw with no blank-line separator is treated as all-headers", () => {
    const before = "From: a@x.com\r\nBcc: e@x.com\r\nSubject: hi\r\n";
    const after = "From: a@x.com\r\nSubject: hi\r\n";
    expect(stripBccHeader(before)).toBe(after);
  });

  test("empty input is a no-op", () => {
    expect(stripBccHeader("")).toBe("");
  });

  test("multiple Bcc headers are all removed", () => {
    // Not strictly valid per RFC 5322 (Bcc is singleton), but defensive.
    const before = join([
      "From: a@x.com",
      "Bcc: e1@x.com",
      "Subject: hi",
      "Bcc: e2@x.com",
      "",
      "body"
    ]);
    const after = join([
      "From: a@x.com",
      "Subject: hi",
      "",
      "body"
    ]);
    expect(stripBccHeader(before)).toBe(after);
  });
});
