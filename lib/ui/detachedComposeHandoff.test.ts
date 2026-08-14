import { describe, expect, it } from "bun:test";
import {
  DETACHED_COMPOSE_SESSION_MAX_AGE_MS,
  parseDetachedComposeEvent,
  parseDetachedComposeHandoff,
  shouldProtectDetachedComposeWindow
} from "./detachedComposeHandoff";

const now = 2_000_000_000_000;
const readySession = {
  version: 1,
  status: "ready",
  accountId: "account@example.test",
  draftId: "draft-1",
  mode: "reply",
  sourceMessageId: "message-1",
  createdAtMs: now - 1_000,
  updatedAtMs: now - 500
};

describe("detached compose handoff parsing", () => {
  it("keeps a ready session durable for reloads", () => {
    expect(parseDetachedComposeHandoff(JSON.stringify(readySession), now)).toEqual(readySession);
    expect(parseDetachedComposeHandoff(JSON.stringify(readySession), now)).toEqual(readySession);
  });

  it("accepts a preparing session and an empty new-message draft", () => {
    const preparing = {
      ...readySession,
      status: "preparing",
      mode: "new",
      sourceMessageId: null,
      draftId: null
    };
    expect(parseDetachedComposeHandoff(JSON.stringify(preparing), now)).toEqual(preparing);
  });

  it("rejects expired, future-dated, and malformed sessions", () => {
    expect(parseDetachedComposeHandoff(JSON.stringify({
      ...readySession,
      updatedAtMs: now - DETACHED_COMPOSE_SESSION_MAX_AGE_MS - 1
    }), now)).toBeNull();
    expect(parseDetachedComposeHandoff(JSON.stringify({
      ...readySession,
      createdAtMs: now + 60_001
    }), now)).toBeNull();
    expect(parseDetachedComposeHandoff(JSON.stringify({
      ...readySession,
      mode: "unknown"
    }), now)).toBeNull();
    expect(parseDetachedComposeHandoff("not-json", now)).toBeNull();
  });
});

describe("detached compose event parsing", () => {
  it("accepts a valid completion event", () => {
    const event = {
      version: 1,
      eventId: "event-1",
      handoffId: "handoff-1",
      accountId: "account@example.test",
      outcome: "sent",
      draftId: "draft-1",
      sourceMessageId: "message-1",
      mode: "forward",
      createdAtMs: now
    };
    expect(parseDetachedComposeEvent(JSON.stringify(event))).toEqual(event);
  });

  it("rejects invalid completion events", () => {
    expect(parseDetachedComposeEvent(JSON.stringify({
      version: 1,
      eventId: "event-1",
      handoffId: "handoff-1",
      accountId: "account@example.test",
      outcome: "lost",
      draftId: null,
      sourceMessageId: null,
      mode: "new",
      createdAtMs: now
    }))).toBeNull();
  });
});

describe("detached compose close protection", () => {
  it("protects dirty and in-flight sessions but not completed ones", () => {
    const clean = {
      completed: false,
      hasUnsavedChanges: false,
      draftSaving: false,
      sendingMail: false,
      discardingDraft: false
    };
    expect(shouldProtectDetachedComposeWindow(clean)).toBe(false);
    expect(shouldProtectDetachedComposeWindow({ ...clean, hasUnsavedChanges: true })).toBe(true);
    expect(shouldProtectDetachedComposeWindow({ ...clean, draftSaving: true })).toBe(true);
    expect(shouldProtectDetachedComposeWindow({ ...clean, sendingMail: true })).toBe(true);
    expect(shouldProtectDetachedComposeWindow({
      ...clean,
      completed: true,
      hasUnsavedChanges: true
    })).toBe(false);
  });
});
