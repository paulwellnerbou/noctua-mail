import { describe, expect, it } from "bun:test";
import type { Attachment, Message } from "@/lib/data";
import { shouldShowAttachmentIcon, resolveInReplyToRef } from "./messageHelpers";

function makeMessage(overrides?: Partial<Message>): Message {
  return {
    id: "m1",
    threadId: "t1",
    subject: "Subject",
    from: "alice@example.com",
    to: "bob@example.com",
    preview: "Preview",
    date: new Date(0).toISOString(),
    dateValue: 0,
    folderId: "acc:INBOX",
    accountId: "acc",
    body: "",
    ...overrides
  };
}

function makeAttachment(overrides?: Partial<Attachment>): Attachment {
  return {
    id: "a1",
    filename: "file.pdf",
    contentType: "application/pdf",
    size: 2048,
    inline: false,
    ...overrides
  };
}

describe("shouldShowAttachmentIcon", () => {
  it("shows icon when lightweight list rows only provide hasAttachments", () => {
    const message = makeMessage({ hasAttachments: true, attachments: [] });
    expect(shouldShowAttachmentIcon(message)).toBe(true);
  });

  it("hides icon when all known non-inline attachments are calendar files", () => {
    const message = makeMessage({
      attachments: [
        makeAttachment({
          filename: "invite.ics",
          contentType: "text/calendar"
        })
      ]
    });
    expect(shouldShowAttachmentIcon(message)).toBe(false);
  });

  it("shows icon when at least one known non-calendar attachment exists", () => {
    const message = makeMessage({
      attachments: [
        makeAttachment({
          filename: "invite.ics",
          contentType: "text/calendar"
        }),
        makeAttachment({
          id: "a2",
          filename: "invoice.pdf",
          contentType: "application/pdf"
        })
      ]
    });
    expect(shouldShowAttachmentIcon(message)).toBe(true);
  });

  it("hides icon for OpenPGP signature attachments", () => {
    const message = makeMessage({
      attachments: [
        makeAttachment({
          filename: "signature.asc",
          contentType: "application/pgp-signature",
          size: 540
        })
      ]
    });
    expect(shouldShowAttachmentIcon(message)).toBe(false);
  });

  it("hides icon when all non-inline attachments are tiny", () => {
    const message = makeMessage({
      attachments: [
        makeAttachment({
          filename: "tiny.txt",
          contentType: "text/plain",
          size: 512
        })
      ]
    });
    expect(shouldShowAttachmentIcon(message)).toBe(false);
  });
});

describe("resolveInReplyToRef", () => {
  const targetMessage = makeMessage({
    id: "target-id",
    messageId: "<abc123@example.com>",
    subject: "Original subject"
  });

  function makeMap(...messages: Message[]): Map<string, Message> {
    const map = new Map<string, Message>();
    for (const m of messages) {
      if (m.messageId) map.set(m.messageId, m);
    }
    return map;
  }

  it("returns null when message has no inReplyTo, xForwardedMessageId, or references", () => {
    const message = makeMessage();
    expect(resolveInReplyToRef(message, makeMap())).toBeNull();
  });

  it("returns null when target message is not in the map", () => {
    const message = makeMessage({ inReplyTo: "<abc123@example.com>" });
    expect(resolveInReplyToRef(message, makeMap())).toBeNull();
  });

  it("resolves inReplyTo when target is in the map", () => {
    const message = makeMessage({ inReplyTo: "<abc123@example.com>" });
    const result = resolveInReplyToRef(message, makeMap(targetMessage));
    expect(result).not.toBeNull();
    expect(result!.refId).toBe("<abc123@example.com>");
    expect(result!.target).toBe(targetMessage);
    expect(result!.isForward).toBe(false);
  });

  it("prefers xForwardedMessageId over inReplyTo", () => {
    const forwardedTarget = makeMessage({ id: "fwd-id", messageId: "<fwd@example.com>" });
    const message = makeMessage({
      xForwardedMessageId: "<fwd@example.com>",
      inReplyTo: "<abc123@example.com>"
    });
    const result = resolveInReplyToRef(message, makeMap(targetMessage, forwardedTarget));
    expect(result).not.toBeNull();
    expect(result!.refId).toBe("<fwd@example.com>");
    expect(result!.target).toBe(forwardedTarget);
    expect(result!.isForward).toBe(true);
  });

  it("falls back to last references entry when inReplyTo is not set", () => {
    const refTarget = makeMessage({ id: "ref-id", messageId: "<ref@example.com>" });
    const message = makeMessage({
      references: ["<first@example.com>", "<ref@example.com>"]
    });
    const result = resolveInReplyToRef(message, makeMap(refTarget));
    expect(result).not.toBeNull();
    expect(result!.refId).toBe("<ref@example.com>");
    expect(result!.isForward).toBe(false);
  });

  it("returns null when inReplyTo is set but target not in map (the missing link case)", () => {
    // Simulates the scenario where a Sent message has In-Reply-To pointing to
    // a message not loaded in the current view — the link must not be rendered.
    const message = makeMessage({
      inReplyTo: "<4855a7bf-a4d1-44be-8c51-df05fde64c71@wellnerbou.de>"
    });
    expect(resolveInReplyToRef(message, makeMap())).toBeNull();
  });
});
