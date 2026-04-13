import { describe, expect, it } from "bun:test";
import type { Message } from "@/lib/data";
import {
  doesCachedThreadCoverMessages,
  getComposeThreadFocusMessageId,
  getInlineComposePlacement,
  getVisibleThreadMessages
} from "./threadViewState";

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

describe("getVisibleThreadMessages", () => {
  it("hides the autosaved draft row while inline compose is open", () => {
    const original = makeMessage({ id: "original" });
    const draft = makeMessage({ id: "draft-1", draft: true, folderId: "acc:Drafts" });

    const result = getVisibleThreadMessages({
      activeThread: [original, draft],
      showComposeInline: true,
      composeDraftId: "draft-1"
    });

    expect(result).toEqual([original]);
  });

  it("keeps the draft row visible when inline compose is not open", () => {
    const original = makeMessage({ id: "original" });
    const draft = makeMessage({ id: "draft-1", draft: true, folderId: "acc:Drafts" });

    const result = getVisibleThreadMessages({
      activeThread: [original, draft],
      showComposeInline: false,
      composeDraftId: "draft-1"
    });

    expect(result).toEqual([original, draft]);
  });

  it("keeps the thread unchanged when there is no current compose draft", () => {
    const original = makeMessage({ id: "original" });
    const draft = makeMessage({ id: "draft-1", draft: true, folderId: "acc:Drafts" });

    const result = getVisibleThreadMessages({
      activeThread: [original, draft],
      showComposeInline: true,
      composeDraftId: null
    });

    expect(result).toEqual([original, draft]);
  });
});

describe("getInlineComposePlacement", () => {
  it("renders inline compose beneath the reply target when that message is visible", () => {
    const original = makeMessage({ id: "original" });
    const draft = makeMessage({ id: "draft-1", draft: true, folderId: "acc:Drafts" });

    expect(
      getInlineComposePlacement({
        activeThread: [original, draft],
        showComposeInline: true,
        composeReplyMessage: original
      })
    ).toEqual({
      replyMessageInThread: true,
      showComposeAtTop: false,
      composeReplyMessageId: "original"
    });
  });

  it("keeps compose at the top when the reply target is not in the visible thread", () => {
    const original = makeMessage({ id: "original" });
    const hiddenTarget = makeMessage({ id: "hidden-target" });

    expect(
      getInlineComposePlacement({
        activeThread: [original],
        showComposeInline: true,
        composeReplyMessage: hiddenTarget
      })
    ).toEqual({
      replyMessageInThread: false,
      showComposeAtTop: true,
      composeReplyMessageId: null
    });
  });
});

describe("getComposeThreadFocusMessageId", () => {
  it("prefers the compose reply target when one exists", () => {
    expect(
      getComposeThreadFocusMessageId({
        showComposeInline: true,
        composeReplyMessage: { id: "reply-target" },
        activeMessage: { id: "active" },
        composeDraftId: "draft-1"
      })
    ).toBe("reply-target");
  });

  it("falls back to the active message, then the draft id", () => {
    expect(
      getComposeThreadFocusMessageId({
        showComposeInline: true,
        composeReplyMessage: null,
        activeMessage: { id: "active" },
        composeDraftId: "draft-1"
      })
    ).toBe("active");

    expect(
      getComposeThreadFocusMessageId({
        showComposeInline: true,
        composeReplyMessage: null,
        activeMessage: null,
        composeDraftId: "draft-1"
      })
    ).toBe("draft-1");
  });

  it("returns null when inline compose is closed", () => {
    expect(
      getComposeThreadFocusMessageId({
        showComposeInline: false,
        composeReplyMessage: { id: "reply-target" },
        activeMessage: { id: "active" },
        composeDraftId: "draft-1"
      })
    ).toBeNull();
  });
});

describe("doesCachedThreadCoverMessages", () => {
  it("returns false when the visible thread includes a newer uncached message", () => {
    const original = makeMessage({ id: "original" });
    const reply = makeMessage({ id: "reply" });

    expect(
      doesCachedThreadCoverMessages({
        activeThread: [original, reply],
        cachedThread: [original]
      })
    ).toBe(false);
  });

  it("returns true when the cached thread already includes every visible message", () => {
    const original = makeMessage({ id: "original" });
    const reply = makeMessage({ id: "reply" });

    expect(
      doesCachedThreadCoverMessages({
        activeThread: [original, reply],
        cachedThread: [reply, original]
      })
    ).toBe(true);
  });
});
