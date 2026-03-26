import { describe, expect, it } from "bun:test";
import { buildSendPayload } from "./buildSendPayload";
import type { SendPayloadInput } from "./buildSendPayload";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<SendPayloadInput> = {}): SendPayloadInput {
  return {
    composeTo: "bob@example.com",
    composeCc: "",
    composeBcc: "",
    composeSubject: "Hello",
    text: "Hi there",
    markdown: undefined,
    html: undefined,
    attachments: [],
    composeFormat: "text",
    composeReplyHeaders: null,
    composeReplyMessage: null,
    accountFromValue: "Alice <alice@example.com>",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Basic fields
// ---------------------------------------------------------------------------

describe("buildSendPayload — basic fields", () => {
  it("passes through recipients, subject, text and attachments", () => {
    const payload = buildSendPayload("new", makeInput());
    expect(payload.to).toBe("bob@example.com");
    expect(payload.cc).toBe("");
    expect(payload.bcc).toBe("");
    expect(payload.subject).toBe("Hello");
    expect(payload.text).toBe("Hi there");
    expect(payload.attachments).toEqual([]);
  });

  it("passes through html when provided", () => {
    const payload = buildSendPayload("new", makeInput({ html: "<p>Hi</p>" }));
    expect(payload.html).toBe("<p>Hi</p>");
  });

  it("passes through markdown compose data for server-side html rendering", () => {
    const payload = buildSendPayload(
      "new",
      makeInput({ markdown: "# Hello", composeFormat: "markdown" })
    );
    expect(payload.markdown).toBe("# Hello");
    expect(payload.composeFormat).toBe("markdown");
  });

  it("passes undefined html when not provided", () => {
    const payload = buildSendPayload("new", makeInput({ html: undefined }));
    expect(payload.html).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Threading headers
// ---------------------------------------------------------------------------

describe("buildSendPayload — threading headers", () => {
  const replyHeaders = {
    inReplyTo: "<orig@example.com>",
    references: ["<orig@example.com>"]
  };

  it("includes inReplyTo and references for reply mode", () => {
    const payload = buildSendPayload("reply", makeInput({ composeReplyHeaders: replyHeaders }));
    expect(payload.inReplyTo).toBe("<orig@example.com>");
    expect(payload.references).toEqual(["<orig@example.com>"]);
  });

  it("includes threading headers for replyAll mode", () => {
    const payload = buildSendPayload("replyAll", makeInput({ composeReplyHeaders: replyHeaders }));
    expect(payload.inReplyTo).toBe("<orig@example.com>");
    expect(payload.references).toEqual(["<orig@example.com>"]);
  });

  it("includes threading headers for forward mode", () => {
    const payload = buildSendPayload("forward", makeInput({ composeReplyHeaders: replyHeaders }));
    expect(payload.inReplyTo).toBe("<orig@example.com>");
    expect(payload.references).toEqual(["<orig@example.com>"]);
  });

  it("omits threading headers for new mode", () => {
    const payload = buildSendPayload("new", makeInput({ composeReplyHeaders: replyHeaders }));
    expect(payload.inReplyTo).toBeUndefined();
    expect(payload.references).toBeUndefined();
  });

  it("falls back to composeReplyMessage headers when composeReplyHeaders is null", () => {
    const payload = buildSendPayload(
      "reply",
      makeInput({
        composeReplyHeaders: null,
        composeReplyMessage: {
          id: "msg-1",
          messageId: "<orig@example.com>",
          inReplyTo: "<prev@example.com>",
          references: ["<prev@example.com>"]
        } as never
      })
    );
    expect(payload.inReplyTo).toBe("<orig@example.com>");
    expect(payload.references).toContain("<orig@example.com>");
    expect(payload.references).toContain("<prev@example.com>");
  });
});

// ---------------------------------------------------------------------------
// xForwardedMessageId
// ---------------------------------------------------------------------------

describe("buildSendPayload — xForwardedMessageId", () => {
  it("sets xForwardedMessageId for forward mode", () => {
    const payload = buildSendPayload(
      "forward",
      makeInput({
        composeReplyHeaders: {
          inReplyTo: "<orig@example.com>",
          references: ["<orig@example.com>"],
          xForwardedMessageId: "<orig@example.com>"
        }
      })
    );
    expect(payload.xForwardedMessageId).toBe("<orig@example.com>");
  });

  it("omits xForwardedMessageId for non-forward modes", () => {
    const headers = {
      inReplyTo: "<orig@example.com>",
      references: ["<orig@example.com>"],
      xForwardedMessageId: "<orig@example.com>"
    };
    expect(buildSendPayload("reply", makeInput({ composeReplyHeaders: headers })).xForwardedMessageId).toBeUndefined();
    expect(buildSendPayload("replyAll", makeInput({ composeReplyHeaders: headers })).xForwardedMessageId).toBeUndefined();
    expect(buildSendPayload("new", makeInput({ composeReplyHeaders: headers })).xForwardedMessageId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Reply-To header logic
// ---------------------------------------------------------------------------

describe("buildSendPayload — Reply-To header", () => {
  it("is empty for new compose (no Reply-To needed)", () => {
    const payload = buildSendPayload("new", makeInput());
    expect(payload.replyTo).toBe("");
  });

  it("is empty for forward mode", () => {
    const payload = buildSendPayload("forward", makeInput());
    expect(payload.replyTo).toBe("");
  });

  it("is empty for reply when Reply-To would equal From (standard case)", () => {
    // When accountFromValue is set, reply mode computes replyToHeader = accountFromValue.
    // Since replyToHeader === accountFromValue, normalizedReplyTo is stripped to "".
    const payload = buildSendPayload(
      "reply",
      makeInput({ accountFromValue: "Alice <alice@example.com>" })
    );
    expect(payload.replyTo).toBe("");
  });

  it("is empty for replyAll for the same reason", () => {
    const payload = buildSendPayload(
      "replyAll",
      makeInput({ accountFromValue: "Alice <alice@example.com>" })
    );
    expect(payload.replyTo).toBe("");
  });
});
