import { describe, expect, it } from "bun:test";
import type { Attachment, Message, Topic } from "@/lib/data";
import {
  buildSentMessageFromDraft,
  decrementGroupMetaForMessages,
  hasAssignedTopics,
  resolveInReplyToRef,
  shouldShowAttachmentIcon
} from "./messageHelpers";

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

function makeTopic(overrides?: Partial<Topic>): Topic {
  return {
    id: "topic-1",
    accountId: "acc",
    name: "Topic 1",
    color: "gray",
    imapKeyword: "topic-1",
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  };
}

describe("buildSentMessageFromDraft", () => {
  it("keeps the row id and threadId so the row swaps in place", () => {
    const draft = makeMessage({
      id: "imap-abc",
      threadId: "t-9",
      folderId: "acc:Drafts",
      mailboxPath: "Drafts",
      imapUid: 12,
      draft: true,
      flags: ["\\Draft", "\\Seen"]
    });
    const sent = buildSentMessageFromDraft(draft, {
      sentFolderId: "acc:Sent",
      sentMailboxPath: "Sent",
      sentMessageUid: 44
    });
    expect(sent.id).toBe("imap-abc");
    expect(sent.threadId).toBe("t-9");
    expect(sent.folderId).toBe("acc:Sent");
    expect(sent.mailboxPath).toBe("Sent");
    expect(sent.imapUid).toBe(44);
  });

  it("drops the \\Draft flag, keeps \\Seen, and clears draft markers", () => {
    const draft = makeMessage({
      draft: true,
      unread: true,
      seen: false,
      flags: ["\\Draft"],
      draftInvite: null
    });
    const sent = buildSentMessageFromDraft(draft, {
      sentFolderId: "acc:Sent",
      sentMessageUid: null
    });
    expect(sent.flags).not.toContain("\\Draft");
    expect(sent.flags).toContain("\\Seen");
    expect(sent.draft).toBe(false);
    expect(sent.seen).toBe(true);
    expect(sent.unread).toBe(false);
    // No known Sent UID yet — the background sync fills it in.
    expect(sent.imapUid).toBeUndefined();
  });

  it("does not duplicate \\Seen when the draft already carries it", () => {
    const draft = makeMessage({ flags: ["\\Draft", "\\Seen"] });
    const sent = buildSentMessageFromDraft(draft, { sentFolderId: "acc:Sent" });
    expect(sent.flags?.filter((flag) => flag === "\\Seen")).toHaveLength(1);
  });
});

describe("shouldShowAttachmentIcon", () => {
  it("shows icon when lightweight list rows only provide hasAttachments", () => {
    const message = makeMessage({ hasAttachments: true, attachments: [] });
    expect(shouldShowAttachmentIcon(message)).toBe(true);
  });

  it("shows icon for inline images when the message has no html body to render them", () => {
    const message = makeMessage({
      attachments: [
        makeAttachment({
          inline: true,
          filename: "photo.jpg",
          contentType: "image/jpeg"
        })
      ]
    });
    expect(shouldShowAttachmentIcon(message)).toBe(true);
  });

  it("hides icon for renderable inline images when html is available", () => {
    const message = makeMessage({
      htmlBody: "<html><body><p>Hello</p></body></html>",
      attachments: [
        makeAttachment({
          inline: true,
          filename: "photo.jpg",
          contentType: "image/jpeg"
        })
      ]
    });
    expect(shouldShowAttachmentIcon(message)).toBe(false);
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

describe("hasAssignedTopics", () => {
  it("returns false for undefined or empty topic arrays", () => {
    expect(hasAssignedTopics()).toBe(false);
    expect(hasAssignedTopics([])).toBe(false);
  });

  it("returns false when topic ids are blank", () => {
    expect(hasAssignedTopics([makeTopic({ id: "   " })])).toBe(false);
  });

  it("returns true when at least one topic has a real id", () => {
    expect(hasAssignedTopics([makeTopic()])).toBe(true);
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
      inReplyTo: "<4855a7bf-a4d1-44be-8c51-df05fde64c71@example.test>"
    });
    expect(resolveInReplyToRef(message, makeMap())).toBeNull();
  });
});

describe("decrementGroupMetaForMessages", () => {
  it("decrements the count for the group of each removed message", () => {
    const meta = [
      { key: "Today", label: "Today", count: 5 },
      { key: "Yesterday", label: "Yesterday", count: 3 }
    ];
    const removed = [
      makeMessage({ id: "m1", groupKey: "Today" }),
      makeMessage({ id: "m2", groupKey: "Today" }),
      makeMessage({ id: "m3", groupKey: "Yesterday" })
    ];
    expect(decrementGroupMetaForMessages(meta, removed)).toEqual([
      { key: "Today", label: "Today", count: 3 },
      { key: "Yesterday", label: "Yesterday", count: 2 }
    ]);
  });

  it("drops groups whose count reaches zero", () => {
    const meta = [
      { key: "Today", label: "Today", count: 1 },
      { key: "Older", label: "Older", count: 4 }
    ];
    const removed = [makeMessage({ id: "m1", groupKey: "Today" })];
    expect(decrementGroupMetaForMessages(meta, removed)).toEqual([
      { key: "Older", label: "Older", count: 4 }
    ]);
  });

  it("treats a missing groupKey as 'Other'", () => {
    const meta = [{ key: "Other", label: "Other", count: 2 }];
    const removed = [makeMessage({ id: "m1" })];
    expect(decrementGroupMetaForMessages(meta, removed)).toEqual([
      { key: "Other", label: "Other", count: 1 }
    ]);
  });

  it("clamps at zero when the decrement exceeds the meta count", () => {
    const meta = [{ key: "Today", label: "Today", count: 1 }];
    const removed = [
      makeMessage({ id: "m1", groupKey: "Today" }),
      makeMessage({ id: "m2", groupKey: "Today" })
    ];
    expect(decrementGroupMetaForMessages(meta, removed)).toEqual([]);
  });

  it("returns the same reference when no removed messages match meta keys", () => {
    const meta = [{ key: "Today", label: "Today", count: 5 }];
    const removed = [makeMessage({ id: "m1", groupKey: "NotInMeta" })];
    expect(decrementGroupMetaForMessages(meta, removed)).toBe(meta);
  });

  it("returns the same reference when removed is empty", () => {
    const meta = [{ key: "Today", label: "Today", count: 5 }];
    expect(decrementGroupMetaForMessages(meta, [])).toBe(meta);
  });
});
