import { describe, expect, it } from "bun:test";
import {
  computeComposeInitState,
  getDisplayRecipient,
  normalizeComposeTo,
  uniqueEmails,
  uniqueRecipients
} from "./composeInitState";
import type { ComposeInviteDraft } from "@/lib/composeInvite";
import type { Message } from "@/lib/data";
import { formatMessageDate } from "@/lib/dateFormatting";
import { FORWARDED_MESSAGE_MARKER, hasForwardMetaHtml } from "@/lib/html";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = (s: string) => s;
const deps = { stripHtml: noop, normalizeHtmlDerivedText: noop };
const opts = { accountEmail: "me@example.com", accountDateFormat: "MMM d, yyyy" as const };

function formattedFixtureDate() {
  const message = makeMessage();
  return formatMessageDate(message.dateValue, message.date, opts.accountDateFormat);
}

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

  it("keeps markdown compose when replying from markdown view to an html message", () => {
    const fields = computeComposeInitState(
      "reply",
      makeMessage({ htmlBody: "<p>Hello</p>" }),
      false,
      { ...opts, preferredComposeTab: "markdown" },
      deps
    );
    expect(fields.composeTab).toBe("markdown");
    expect(fields.composeQuotedHtml).not.toBe("");
    expect(fields.composeQuotedParts).not.toBeNull();
  });

  it("uses Reply-To address as To when present on the original message", () => {
    const fields = computeComposeInitState(
      "reply",
      makeMessage({
        from: "Substack <newsletter@substack.com>",
        replyTo: "Author Reply <reply+abc@mg1.substack.com>",
        to: "me@example.com"
      }),
      false,
      opts,
      deps
    );
    expect(fields.composeTo).toBe("Author Reply <reply+abc@mg1.substack.com>");
  });

  it("falls back to From when Reply-To is an empty/whitespace string", () => {
    const fields = computeComposeInitState(
      "reply",
      makeMessage({
        from: "Alice <alice@example.com>",
        replyTo: "   ",
        to: "me@example.com"
      }),
      false,
      opts,
      deps
    );
    expect(fields.composeTo).toBe("Alice <alice@example.com>");
  });

  it("ignores Reply-To when replying to a message the user sent themselves", () => {
    const fields = computeComposeInitState(
      "reply",
      makeMessage({
        from: "me@example.com",
        replyTo: "someone-else@example.com",
        to: "Bob <bob@example.com>"
      }),
      false,
      opts,
      deps
    );
    expect(fields.composeTo).toBe("Bob <bob@example.com>");
  });

  it("falls back to html-derived text when opening a text reply without a text body", () => {
    const fields = computeComposeInitState(
      "reply",
      makeMessage({ body: "", htmlBody: "<p>Hello<br>World</p>" }),
      false,
      { ...opts, preferredComposeTab: "text" },
      {
        ...deps,
        stripHtml: (value) => value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").trim()
      }
    );
    expect(fields.composeTab).toBe("text");
    expect(fields.composeBody).toContain("> Hello");
    expect(fields.composeBody).toContain("> World");
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

  it("puts Reply-To in To and excludes the From sender when Reply-To is set", () => {
    const fields = computeComposeInitState(
      "replyAll",
      makeMessage({
        from: "Mailer Daemon <noreply@list.example.com>",
        replyTo: "list@list.example.com",
        to: "me@example.com, Bob <bob@example.com>",
        cc: "Carol <carol@example.com>"
      }),
      false,
      opts,
      deps
    );
    expect(fields.composeTo).toBe("list@list.example.com");
    expect(fields.composeCc).not.toContain("noreply@list.example.com");
    expect(fields.composeCc).toContain("Bob <bob@example.com>");
    expect(fields.composeCc).toContain("Carol <carol@example.com>");
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

  it("puts the Forwarded-message marker in composeHtml and keeps the quoted block original", () => {
    const fields = computeComposeInitState(
      "forward",
      makeMessage({ from: "Alice <alice@example.com>", htmlBody: "<p>Hello</p>" }),
      false,
      opts,
      deps
    );
    expect(fields.composeTab).toBe("html");
    expect(fields.composeHtml).toBe(`<p>${FORWARDED_MESSAGE_MARKER}</p>`);
    expect(fields.composeHtmlText).toBe(FORWARDED_MESSAGE_MARKER);
    expect(fields.composeQuotedHtml).not.toContain("Forwarded message");
    expect(fields.composeQuotedHtml).toContain("<p>Hello</p>");
  });

  it("keeps the sender out of the marker and escapes it in the header table", () => {
    const fields = computeComposeInitState(
      "forward",
      makeMessage({ from: '"<script>" <x@example.com>', htmlBody: "<p>Hi</p>" }),
      false,
      opts,
      deps
    );
    expect(fields.composeHtml).toBe(`<p>${FORWARDED_MESSAGE_MARKER}</p>`);
    expect(fields.composeQuotedHtml).not.toContain("<script>");
    expect(fields.composeQuotedHtml).toContain("&lt;script&gt;");
  });

  it("puts the Forwarded-message marker in composeMarkdown when forwarding from markdown view", () => {
    const fields = computeComposeInitState(
      "forward",
      makeMessage({ from: "Alice <alice@example.com>", htmlBody: "<p>Hello</p>" }),
      false,
      { ...opts, preferredComposeTab: "markdown" },
      deps
    );
    expect(fields.composeTab).toBe("markdown");
    expect(fields.composeMarkdown).toBe(`${FORWARDED_MESSAGE_MARKER}\n\n`);
    expect(fields.composeHtml).toBe("");
    expect(fields.composeQuotedHtml).not.toContain("Forwarded message");
  });

  it("keeps the Forwarded-message marker embedded in composeBody for text-only forwards", () => {
    const fields = computeComposeInitState(
      "forward",
      makeMessage({ from: "Alice <alice@example.com>", body: "Original", htmlBody: null }),
      false,
      opts,
      deps
    );
    expect(fields.composeTab).toBe("text");
    expect(fields.composeBody).toContain(FORWARDED_MESSAGE_MARKER);
    expect(fields.composeBody).toContain("> Original");
    expect(fields.composeHtml).toBe("");
    expect(fields.composeMarkdown).toBe("");
  });

  it("adds a removable header table with the original's known fields to rich forwards", () => {
    const fields = computeComposeInitState(
      "forward",
      makeMessage({
        from: "Alice <alice@example.com>",
        replyTo: "list@example.com",
        to: "me@example.com, Bob <bob@example.com>",
        cc: "carol@example.com",
        bcc: "secret@example.com",
        subject: "Hello <world>",
        htmlBody: "<p>Hello</p>"
      }),
      false,
      opts,
      deps
    );
    const meta = fields.composeQuotedParts?.metaHtml ?? "";

    expect(meta).toContain('data-noctua-forward-meta="1"');
    expect(meta).toContain("From:</th>");
    expect(meta).toContain("Alice &lt;alice@example.com&gt;");
    expect(meta).toContain("Reply-To:</th>");
    expect(meta).toContain("Date:</th>");
    expect(meta).toContain(formattedFixtureDate());
    expect(meta).toContain("Subject:</th>");
    expect(meta).toContain("Hello &lt;world&gt;");
    expect(meta).toContain("To:</th>");
    expect(meta).toContain("me@example.com, Bob &lt;bob@example.com&gt;");
    expect(meta).toContain("Cc:</th>");
    expect(meta).not.toContain("secret@example.com");
    expect(meta).not.toContain("Bcc");
    // The assembled quoted HTML (used by the payload) carries the table too.
    expect(fields.composeQuotedHtml).toContain('data-noctua-forward-meta="1"');
  });

  it("omits Reply-To when it only repeats the sender", () => {
    const fields = computeComposeInitState(
      "forward",
      makeMessage({
        from: '"Katharina Jockusch" <k@example.com>',
        replyTo: "Katharina Jockusch <K@example.com>",
        htmlBody: "<p>Hello</p>"
      }),
      false,
      opts,
      deps
    );
    const meta = fields.composeQuotedParts?.metaHtml ?? "";

    expect(meta).not.toContain("Reply-To");
    expect(meta).toContain("Katharina Jockusch &lt;k@example.com&gt;");
  });

  it("shows display names without the stored quoting", () => {
    const fields = computeComposeInitState(
      "forward",
      makeMessage({
        from: '"Alice Example" <alice@example.com>',
        to: '"Example, Nadine" <nadine@example.test>, bob@example.com',
        htmlBody: "<p>Hello</p>"
      }),
      false,
      opts,
      deps
    );
    const meta = fields.composeQuotedParts?.metaHtml ?? "";

    expect(meta).toContain("Alice Example &lt;alice@example.com&gt;");
    expect(meta).toContain("Example, Nadine &lt;nadine@example.test&gt;, bob@example.com");
    expect(meta).not.toContain("&quot;");
  });

  it("does not treat a header table inside the quoted body as removable", () => {
    const forwarded = computeComposeInitState(
      "forward",
      makeMessage({ htmlBody: "<p>Hello</p>" }),
      false,
      opts,
      deps
    );
    const reply = computeComposeInitState(
      "reply",
      makeMessage({ htmlBody: forwarded.composeQuotedHtml }),
      false,
      opts,
      deps
    );

    expect(reply.composeQuotedParts?.metaHtml).toBeUndefined();
    expect(reply.composeQuotedHtml).toContain('data-noctua-forward-meta="1"');
    expect(hasForwardMetaHtml(reply.composeQuotedHtml)).toBe(false);
  });

  it("omits header rows whose value is unknown", () => {
    const fields = computeComposeInitState(
      "forward",
      makeMessage({ cc: null, replyTo: null, htmlBody: "<p>Hello</p>" }),
      false,
      opts,
      deps
    );
    const meta = fields.composeQuotedParts?.metaHtml ?? "";

    expect(meta).not.toContain("Cc:");
    expect(meta).not.toContain("Reply-To:");
    expect(meta).toContain("From:");
  });

  it("embeds the header fields as text lines between the prefix and the quoted body in text forwards", () => {
    const fields = computeComposeInitState(
      "forward",
      makeMessage({
        from: "Alice <alice@example.com>",
        to: "me@example.com",
        cc: "carol@example.com",
        subject: "Hello",
        body: "Original",
        htmlBody: null
      }),
      false,
      opts,
      deps
    );

    const date = formattedFixtureDate();
    expect(fields.composeBody).toBe(
      [
        "",
        "",
        FORWARDED_MESSAGE_MARKER,
        "From: Alice <alice@example.com>",
        `Date: ${date}`,
        "Subject: Hello",
        "To: me@example.com",
        "Cc: carol@example.com",
        "",
        "> Original"
      ].join("\n")
    );
    expect(fields.composeQuotedParts).toBeNull();
  });

  it("does not add the header table to replies", () => {
    const fields = computeComposeInitState(
      "reply",
      makeMessage({ htmlBody: "<p>Hello</p>" }),
      false,
      opts,
      deps
    );
    expect(fields.composeQuotedParts?.metaHtml).toBeUndefined();
    expect(fields.composeQuotedHtml).not.toContain("data-noctua-forward-meta");
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

  it("restores markdown source when editing a markdown draft", () => {
    const fields = computeComposeInitState(
      "edit",
      makeMessage({
        body: "# Heading\n\n**Important** details",
        htmlBody: "<h1>Heading</h1><p><strong>Important</strong> details</p>",
        xComposeFormat: "markdown"
      }),
      false,
      opts,
      deps
    );
    expect(fields.composeTab).toBe("markdown");
    expect(fields.composeMarkdown).toBe("# Heading\n\n**Important** details");
    expect(JSON.parse(fields.initialDraftHash!)).toMatchObject({
      text: "# Heading\n\n**Important** details",
      html: ""
    });
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

  it("restores saved draft invite fields", () => {
    const draftInvite: ComposeInviteDraft = {
      location: "Desk",
      start: "2026-03-26T09:00",
      end: "2026-03-26T10:00",
      allDay: false,
      recurrenceRule: "FREQ=DAILY"
    };
    const fields = computeComposeInitState(
      "edit",
      makeMessage({ draftInvite, subject: "Ignored subject fallback" }),
      false,
      opts,
      deps
    );
    expect(fields.composeIncludeInvite).toBe(true);
    expect(fields.composeInviteLocation).toBe("Desk");
    expect(fields.composeInviteStart).toBe("2026-03-26T09:00");
    expect(fields.composeInviteEnd).toBe("2026-03-26T10:00");
    expect(fields.composeInviteAllDay).toBe(false);
    expect(fields.composeInviteRecurrenceRule).toBe("FREQ=DAILY");
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
