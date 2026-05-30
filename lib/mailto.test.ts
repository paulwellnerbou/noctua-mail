import { describe, expect, it } from "bun:test";
import { parseMailto } from "./mailto";

describe("parseMailto", () => {
  it("parses a bare mailto: with a single recipient", () => {
    expect(parseMailto("mailto:alice@example.com")).toEqual({
      to: "alice@example.com",
      cc: "",
      bcc: "",
      subject: "",
      body: ""
    });
  });

  it("parses multiple comma-separated recipients in the path", () => {
    expect(parseMailto("mailto:alice@example.com,bob@example.com").to).toBe(
      "alice@example.com, bob@example.com"
    );
  });

  it("decodes percent-encoded recipients", () => {
    expect(parseMailto("mailto:alice%40example.com").to).toBe("alice@example.com");
  });

  it("parses subject, cc, bcc, and body from the query string", () => {
    const r = parseMailto(
      "mailto:alice@example.com?subject=Hello%20world&cc=carol@example.com&bcc=dan@example.com&body=Hi%20Alice"
    );
    expect(r.to).toBe("alice@example.com");
    expect(r.subject).toBe("Hello world");
    expect(r.cc).toBe("carol@example.com");
    expect(r.bcc).toBe("dan@example.com");
    expect(r.body).toBe("Hi Alice");
  });

  it("treats + as space in body and subject", () => {
    const r = parseMailto("mailto:a@b.com?subject=Hi+there&body=line+one");
    expect(r.subject).toBe("Hi there");
    expect(r.body).toBe("line one");
  });

  it("merges path and query to= recipients", () => {
    const r = parseMailto("mailto:alice@example.com?to=bob@example.com");
    expect(r.to).toBe("alice@example.com, bob@example.com");
  });

  it("decodes newlines in body", () => {
    const r = parseMailto("mailto:a@b.com?body=line%20one%0Aline%20two");
    expect(r.body).toBe("line one\nline two");
  });

  it("is case-insensitive on header names", () => {
    const r = parseMailto("mailto:a@b.com?Subject=Hi&CC=c@d.com");
    expect(r.subject).toBe("Hi");
    expect(r.cc).toBe("c@d.com");
  });

  it("ignores unknown headers", () => {
    const r = parseMailto("mailto:a@b.com?priority=high&subject=Hi");
    expect(r.subject).toBe("Hi");
  });

  it("parses in-reply-to and references", () => {
    const r = parseMailto(
      "mailto:a@b.com?in-reply-to=%3Cmsg1@x%3E&references=%3Cmsg0@x%3E%20%3Cmsg1@x%3E"
    );
    expect(r.inReplyTo).toBe("<msg1@x>");
    expect(r.references).toEqual(["<msg0@x>", "<msg1@x>"]);
  });

  it("returns blank fields for an empty input", () => {
    expect(parseMailto("")).toEqual({ to: "", cc: "", bcc: "", subject: "", body: "" });
  });

  it("handles mailto: with no recipient (compose blank)", () => {
    const r = parseMailto("mailto:?subject=Hi");
    expect(r.to).toBe("");
    expect(r.subject).toBe("Hi");
  });

  it("tolerates malformed percent-encoding without throwing", () => {
    const r = parseMailto("mailto:a@b.com?subject=%E0%A");
    expect(r.to).toBe("a@b.com");
    // Subject may contain the raw fragment; we just don't crash.
    expect(typeof r.subject).toBe("string");
  });

  it("accepts input without the mailto: prefix", () => {
    expect(parseMailto("alice@example.com?subject=Hi").to).toBe("alice@example.com");
  });

  it("preserves + in path recipients (Gmail sub-address)", () => {
    // RFC 6068: `+` is never decoded as space in mailto URLs. Decoding it
    // would corrupt the local part of `user+tag@gmail.com`.
    expect(parseMailto("mailto:user+tag@gmail.com").to).toBe("user+tag@gmail.com");
  });

  it("preserves + in query recipient headers", () => {
    const r = parseMailto("mailto:?to=a+x@gmail.com&cc=b+y@gmail.com&bcc=c+z@gmail.com");
    expect(r.to).toBe("a+x@gmail.com");
    expect(r.cc).toBe("b+y@gmail.com");
    expect(r.bcc).toBe("c+z@gmail.com");
  });

  it("preserves + in in-reply-to and references", () => {
    const r = parseMailto(
      "mailto:a@b.com?in-reply-to=%3Cfoo+bar@x%3E&references=%3Cfoo+bar@x%3E"
    );
    expect(r.inReplyTo).toBe("<foo+bar@x>");
    expect(r.references).toEqual(["<foo+bar@x>"]);
  });
});
