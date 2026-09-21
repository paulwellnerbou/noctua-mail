import { describe, expect, it } from "bun:test";
import type { Message } from "@/lib/data";
import {
  doesCachedThreadCoverMessages,
  getComposeThreadFocusMessageId,
  getInlineComposePlacement,
  getRenderedThreadMessages,
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

describe("getRenderedThreadMessages", () => {
  const original = makeMessage({ id: "original" });
  const draft = makeMessage({ id: "draft-1", draft: true, folderId: "acc:Drafts" });
  const base = {
    activeMessage: draft,
    activeThread: [original, draft],
    supportsThreads: true,
    threadContentById: { t1: [original, draft] },
    threadContentLoading: null,
    showComposeInline: false,
    composeDraftId: null
  };

  it("renders the whole thread when threads are supported", () => {
    expect(getRenderedThreadMessages(base)).toEqual([original, draft]);
  });

  it("renders only the active message when threads are off", () => {
    expect(getRenderedThreadMessages({ ...base, supportsThreads: false })).toEqual([draft]);
  });

  it("renders only the active message while the full thread is still loading", () => {
    expect(
      getRenderedThreadMessages({ ...base, threadContentById: {}, threadContentLoading: "t1" })
    ).toEqual([draft]);
  });

  it("renders nothing without an active message", () => {
    expect(getRenderedThreadMessages({ ...base, activeMessage: null })).toEqual([]);
  });

  // Editing a reply/forward draft from the Drafts folder: threads are off
  // there, but the cached thread still contains the original message.
  it("places compose at the top when the reply target is cached but not rendered", () => {
    const rendered = getRenderedThreadMessages({
      ...base,
      supportsThreads: false,
      showComposeInline: true,
      composeDraftId: "draft-1"
    });

    expect(rendered).toEqual([]);
    expect(
      getInlineComposePlacement({
        activeThread: rendered,
        showComposeInline: true,
        composeReplyMessage: original
      })
    ).toEqual({
      replyMessageInThread: false,
      showComposeAtTop: true,
      composeReplyMessageId: null
    });
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
