import { describe, expect, it } from "bun:test";
import { buildImapMessageRowId } from "@/lib/messageIds";

describe("buildImapMessageRowId", () => {
  it("is stable for the same RFC message id", () => {
    const a = buildImapMessageRowId("<Example@Mail.Host>");
    const b = buildImapMessageRowId("<example@mail.host>");
    expect(a).toBe(b);
    expect(a.startsWith("imap-")).toBe(true);
    expect(a).not.toContain("mailbox");
    expect(a).not.toContain("account");
  });

  it("uses fallback metadata when message id is missing", () => {
    const a = buildImapMessageRowId(undefined, {
      dateValue: 1738157000000,
      from: "\"Sender\" <sender@example.com>",
      to: "receiver@example.com",
      subject: "Fallback test",
      inReplyTo: "<parent@example.com>"
    });
    const b = buildImapMessageRowId("", {
      dateValue: 1738157000000,
      from: "\"Sender\" <sender@example.com>",
      to: "receiver@example.com",
      subject: "Fallback test",
      inReplyTo: "<parent@example.com>"
    });
    expect(a).toBe(b);
  });

  it("treats synthetic imap placeholder ids as missing", () => {
    const a = buildImapMessageRowId("imap-msg-42", {
      dateValue: 1738157000000,
      from: "sender@example.com",
      to: "receiver@example.com",
      subject: "Fallback test"
    });
    const b = buildImapMessageRowId(undefined, {
      dateValue: 1738157000000,
      from: "sender@example.com",
      to: "receiver@example.com",
      subject: "Fallback test"
    });
    expect(a).toBe(b);
  });
});
