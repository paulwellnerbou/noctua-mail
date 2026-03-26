import { describe, expect, it } from "bun:test";
import {
  computeComposeInitState,
  getDisplayRecipient,
  normalizeComposeTo,
  prefixSubject,
  uniqueEmails,
  uniqueRecipients
} from "./composeInitState";
import type { Message } from "@/lib/data";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = (s: string) => s;
const deps = { stripHtml: noop, normalizeHtmlDerivedText: noop };
const opts = { accountEmail: "me@example.com", accountDateFormat: "MMM d, yyyy" as const };

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    accountId: "acc-1",
    folderId: "acc-1:INBOX",
    messageId: "<msg1@example.com>",
    from: "Alice <alice@example.com>",
    to: "me@example.com",
    cc: null,
    bcc: null,
    subject: "Hello",
    body: "Original body",
    htmlBody: null,
    date: "Mon, 1 Jan 2024 12:00:00 +0000",
    dateValue: 1704110400000,
    inReplyTo: null,
    references: null,
    xForwardedMessageId: null,
    xComposeFormat: null,
    quotedHtmlEdited: null,
    threadId: "thread-1",
    parentId: null,
    uid: 1,
    flags: [],
    attachmentCount: 0,
    preview: "Original body",
    isSeen: true,
    isFlagged: false,
    isDraft: false,
    isTodo: false,
    isAnswered: false,
    isForwarded: false,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe("getDisplayRecipient", () => {
  it("extracts name and email from full format", () => {
    expect(getDisplayRecipient("Alice Smith <alice@example.com>")).toBe(
      "Alice Smith <alice@example.com>"
    );
  });

  it("strips surrounding quotes from name", () => {
    expect(getDisplayRecipient('"Alice" <alice@example.com>')).toBe("Alice <alice@example.com>");
  });

  it("returns just the email when no name is present", () => {
    expect(getDisplayRecipient("alice@example.com")).toBe("alice@example.com");
  });

  it("returns empty string for empty input", () => {
    expect(getDisplayRecipient("")).toBe("");
  });
});

describe("prefixSubject", () => {
  it("adds Re: prefix", () => {
    expect(prefixSubject("Re", "Hello")).toBe("Re: Hello");
  });

  it("does not double-add Re: prefix", () => {
    expect(prefixSubject("Re", "Re: Hello")).toBe("Re: Hello");
  });

  it("adds Fwd: prefix", () => {
    expect(prefixSubject("Fwd", "Hello")).toBe("Fwd: Hello");
  });

  it("does not double-add Fwd: prefix", () => {
    expect(prefixSubject("Fwd", "Fwd: Hello")).toBe("Fwd: Hello");
  });

  it("handles empty subject", () => {
    expect(prefixSubject("Re", "")).toBe("Re: (no subject)");
  });

  it("is case-insensitive for the existing prefix check", () => {
    expect(prefixSubject("Re", "re: Hello")).toBe("re: Hello");
  });
});

describe("normalizeComposeTo", () => {
  it("returns empty string for undisclosed recipients", () => {
    expect(normalizeComposeTo("undisclosed-recipients:;")).toBe("");
    expect(normalizeComposeTo("Undisclosed Recipients")).toBe("");
  });

  it("passes through normal email addresses", () => {
    expect(normalizeComposeTo("alice@example.com")).toBe("alice@example.com");
  });

  it("trims whitespace", () => {
    expect(normalizeComposeTo("  alice@example.com  ")).toBe("alice@example.com");
  });
});

describe("uniqueEmails", () => {
  it("deduplicates case-insensitively", () => {
    expect(uniqueEmails(["a@b.com", "A@B.COM", "c@d.com"])).toEqual(["a@b.com", "c@d.com"]);
  });
});

describe("uniqueRecipients", () => {
  it("deduplicates by email address regardless of display name", () => {
    expect(
      uniqueRecipients(["Alice <alice@example.com>", "alice@example.com", "Bob <bob@example.com>"])
    ).toEqual(["Alice <alice@example.com>", "Bob <bob@example.com>"]);
  });
});

// ---------------------------------------------------------------------------
// computeComposeInitState — new
// ---------------------------------------------------------------------------

describe("computeComposeInitState — new", () => {
  it("returns all blank fields for new compose with no message", () => {
    const fields = computeComposeInitState("new", undefined, false, opts, deps);
    expect(fields.composeTo).toBe("");
    expect(fields.composeSubject).toBe("");
    expect(fields.composeBody).toBe("");
    expect(fields.composeDraftId).toBeNull();
    expect(fields.composeTab).toBe("html");
  });
});

// ---------------------------------------------------------------------------
// computeComposeInitState — reply
// ---------------------------------------------------------------------------

describe("computeComposeInitState — reply", () => {
  it("sets To from message From when message is from someone else", () => {
    const fields = computeComposeInitState(
      "reply",
      makeMessage({ from: "Alice <alice@example.com>", to: "me@example.com" }),
      false,
      opts,
      deps
    );
    expect(fields.composeTo).toBe("Alice <alice@example.com>");
    expect(fields.composeCc).toBe("");
  });

  it("replies to first To recipient when message is from self", () => {
    const fields = computeComposeInitState(
      "reply",
      makeMessage({
        from: "me@example.com",
        to: "Bob <bob@example.com>, Carol <carol@example.com>"
      }),
      false,
      opts,
      deps
    );
    expect(fields.composeTo).toBe("Bob <bob@example.com>");
  });

  it("preserves quoted commas in the first recipient when replying to self", () => {
    const fields = computeComposeInitState(
      "reply",
      makeMessage({
        from: "me@example.com",
        to: '"Example, Nadine" <nadine@example.test>, Carol <carol@example.com>'
      }),
      false,
      opts,
      deps
    );
    expect(fields.composeTo).toBe("Example, Nadine <nadine@example.test>");
  });

  it("prefixes subject with Re:", () => {
    const fields = computeComposeInitState(
      "reply",
      makeMessage({ subject: "Hello" }),
      false,
      opts,
      deps
    );
    expect(fields.composeSubject).toBe("Re: Hello");
  });

  it("does not double-prefix subject", () => {
    const fields = computeComposeInitState(
      "reply",
      makeMessage({ subject: "Re: Hello" }),
      false,
      opts,
      deps
    );
    expect(fields.composeSubject).toBe("Re: Hello");
  });

  it("sets reply headers", () => {
    const fields = computeComposeInitState(
      "reply",
      makeMessage({ messageId: "<msg1@example.com>" }),
      false,
      opts,
      deps
    );
    expect(fields.composeReplyHeaders?.inReplyTo).toBe("<msg1@example.com>");
    expect(fields.composeReplyHeaders?.references).toContain("<msg1@example.com>");
  });

  it("uses text tab and buildTextReplyBody when message has no HTML", () => {
    const fields = computeComposeInitState(
      "reply",
      makeMessage({ body: "Original body", htmlBody: null }),
      false,
      opts,
      deps
    );
    expect(fields.composeTab).toBe("text");
    expect(fields.composeBody).toContain("> Original body");
    expect(fields.composeQuotedHtml).toBe("");
  });

  it("uses html tab and quoted html when message has HTML content", () => {
    const fields = computeComposeInitState(
      "reply",
      makeMessage({ htmlBody: "<p>Hello</p>" }),
      false,
      opts,
      deps
    );
    expect(fields.composeTab).toBe("html");
    expect(fields.composeQuotedHtml).not.toBe("");
    expect(fields.composeBody).toBe("");
  });
});

// ---------------------------------------------------------------------------
// computeComposeInitState — replyAll
// ---------------------------------------------------------------------------

describe("computeComposeInitState — replyAll", () => {
  it("excludes own email from Cc", () => {
    const fields = computeComposeInitState(
      "replyAll",
      makeMessage({
        from: "Alice <alice@example.com>",
        to: "me@example.com, Bob <bob@example.com>",
        cc: null
      }),
      false,
      opts,
      deps
    );
    const allRecipients = [fields.composeTo, fields.composeCc].join(",");
    expect(allRecipients).not.toContain("me@example.com");
  });

  it("puts sender in To and other recipients in Cc", () => {
    const fields = computeComposeInitState(
      "replyAll",
      makeMessage({
        from: "Alice <alice@example.com>",
        to: "me@example.com, Bob <bob@example.com>",
        cc: null
      }),
      false,
      opts,
      deps
    );
    expect(fields.composeTo).toContain("Alice");
    expect(fields.composeCc).toContain("Bob");
  });

  it("does not duplicate recipients between To and Cc", () => {
    const fields = computeComposeInitState(
      "replyAll",
      makeMessage({
        from: "Alice <alice@example.com>",
        to: "me@example.com",
        cc: "Alice <alice@example.com>"
      }),
      false,
      opts,
      deps
    );
    const allRecipients = [fields.composeTo, fields.composeCc].filter(Boolean).join(",");
    const aliceCount = (allRecipients.match(/alice@example\.com/gi) ?? []).length;
    expect(aliceCount).toBe(1);
  });

  it("keeps quoted-comma recipient names intact when replying all to a sent message", () => {
    const fields = computeComposeInitState(
      "replyAll",
      makeMessage({
        from: "me@example.com",
        to: '"Example, Nadine" <nadine@example.test>, Bob <bob@example.com>',
        cc: '"Smith, Carol" <carol@example.com>'
      }),
      false,
      opts,
      deps
    );
    expect(fields.composeTo).toContain("Example, Nadine <nadine@example.test>");
    expect(fields.composeTo).toContain("Bob <bob@example.com>");
    expect(fields.composeCc).toBe("carol@example.com");
  });
});

// ---------------------------------------------------------------------------
// computeComposeInitState — forward
// ---------------------------------------------------------------------------

describe("computeComposeInitState — forward", () => {
  it("has empty recipients", () => {
    const fields = computeComposeInitState("forward", makeMessage(), false, opts, deps);
    expect(fields.composeTo).toBe("");
    expect(fields.composeCc).toBe("");
  });

  it("prefixes subject with Fwd:", () => {
    const fields = computeComposeInitState(
      "forward",
      makeMessage({ subject: "Hello" }),
      false,
      opts,
      deps
    );
    expect(fields.composeSubject).toBe("Fwd: Hello");
  });

  it("sets xForwardedMessageId in reply headers", () => {
    const fields = computeComposeInitState(
      "forward",
      makeMessage({ messageId: "<msg1@example.com>" }),
      false,
      opts,
      deps
    );
    expect(fields.composeReplyHeaders?.xForwardedMessageId).toBe("<msg1@example.com>");
  });
});

// ---------------------------------------------------------------------------
// computeComposeInitState — edit
// ---------------------------------------------------------------------------

describe("computeComposeInitState — edit", () => {
  it("sets composeDraftId to message id", () => {
    const fields = computeComposeInitState(
      "edit",
      makeMessage({ id: "draft-1" }),
      false,
      opts,
      deps
    );
    expect(fields.composeDraftId).toBe("draft-1");
  });

  it("does not set composeDraftId when asNew is true", () => {
    const fields = computeComposeInitState(
      "edit",
      makeMessage({ id: "draft-1" }),
      true,
      opts,
      deps
    );
    expect(fields.composeDraftId).toBeNull();
  });

  it("populates recipients from message fields", () => {
    const fields = computeComposeInitState(
      "edit",
      makeMessage({ to: "bob@example.com", cc: "carol@example.com", bcc: null }),
      false,
      opts,
      deps
    );
    expect(fields.composeTo).toBe("bob@example.com");
    expect(fields.composeCc).toBe("carol@example.com");
    expect(fields.composeShowBcc).toBe(true);
  });

  it("sets initialDraftHash for dirty tracking", () => {
    const fields = computeComposeInitState("edit", makeMessage(), false, opts, deps);
    expect(fields.initialDraftHash).not.toBeNull();
  });

  it("includes attachment metadata in the initial draft hash", () => {
    const fields = computeComposeInitState(
      "edit",
      makeMessage({
        attachments: [
          {
            id: "att-1",
            filename: "contract.pdf",
            contentType: "application/pdf",
            size: 42,
            inline: false
          }
        ]
      }),
      false,
      opts,
      deps
    );

    expect(fields.initialDraftHash).not.toBeNull();
    expect(JSON.parse(fields.initialDraftHash!)).toMatchObject({
      attachments: "contract.pdf:42:0:"
    });
  });

  it("does not set initialDraftHash when asNew is true", () => {
    const fields = computeComposeInitState("edit", makeMessage(), true, opts, deps);
    expect(fields.initialDraftHash).toBeNull();
  });

  it("resolves composeReplyMessage via findMessageByMessageId", () => {
    const originalMsg = makeMessage({ id: "original-1" });
    const findMessageByMessageId = (id: string) => (id === "<msg1@example.com>" ? originalMsg : undefined);
    const draft = makeMessage({ inReplyTo: "<msg1@example.com>" });
    const fields = computeComposeInitState(
      "edit",
      draft,
      false,
      { ...opts, findMessageByMessageId },
      deps
    );
    expect(fields.composeReplyMessage).toBe(originalMsg);
  });
});
