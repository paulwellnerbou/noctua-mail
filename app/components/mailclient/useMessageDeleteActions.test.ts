import { describe, expect, it } from "bun:test";
import type { Message } from "@/lib/data";
import { resolveDeleteTargets } from "./useMessageDeleteActions";

function makeMessage(overrides?: Partial<Message>): Message {
  return {
    id: "m1",
    threadId: "thread-1",
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

const thread = [
  makeMessage({ id: "m1" }),
  makeMessage({ id: "m2" }),
  makeMessage({ id: "m3" })
];

const baseParams = {
  message: thread[0],
  allowThreadDeletion: true,
  supportsThreads: true,
  collapsedThreads: {} as Record<string, boolean>,
  threadScopeMessages: thread,
  activeAccountId: "acc"
};

describe("resolveDeleteTargets", () => {
  it("targets the whole thread when the thread has no collapse entry (collapsed by default)", () => {
    const result = resolveDeleteTargets(baseParams);

    expect(result.kind).toBe("thread");
    expect(result.targets.map((item) => item.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("targets the whole thread when the thread is explicitly collapsed", () => {
    const result = resolveDeleteTargets({
      ...baseParams,
      collapsedThreads: { "thread-1": true }
    });

    expect(result.kind).toBe("thread");
    expect(result.targets.map((item) => item.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("targets only the clicked message when the thread is expanded", () => {
    const result = resolveDeleteTargets({
      ...baseParams,
      collapsedThreads: { "thread-1": false }
    });

    expect(result.kind).toBe("message");
    expect(result.targets.map((item) => item.id)).toEqual(["m1"]);
  });

  it("targets only the clicked message when thread deletion is not allowed", () => {
    const result = resolveDeleteTargets({
      ...baseParams,
      allowThreadDeletion: false
    });

    expect(result.kind).toBe("message");
    expect(result.targets.map((item) => item.id)).toEqual(["m1"]);
  });

  it("targets only the clicked message when threads are unsupported", () => {
    const result = resolveDeleteTargets({
      ...baseParams,
      supportsThreads: false
    });

    expect(result.kind).toBe("message");
    expect(result.targets.map((item) => item.id)).toEqual(["m1"]);
  });

  it("targets only the clicked message when the thread has a single message", () => {
    const single = makeMessage({ id: "s1", threadId: "thread-solo" });
    const result = resolveDeleteTargets({
      ...baseParams,
      message: single,
      threadScopeMessages: [single, ...thread]
    });

    expect(result.kind).toBe("message");
    expect(result.targets.map((item) => item.id)).toEqual(["s1"]);
  });

  it("ignores same-thread messages from other accounts", () => {
    const result = resolveDeleteTargets({
      ...baseParams,
      threadScopeMessages: [
        thread[0],
        makeMessage({ id: "other-1", accountId: "other" }),
        makeMessage({ id: "other-2", accountId: "other" })
      ]
    });

    expect(result.kind).toBe("message");
    expect(result.targets.map((item) => item.id)).toEqual(["m1"]);
  });

  it("falls back to messageId/id as the thread key when threadId is missing", () => {
    const root = makeMessage({ id: "r1", threadId: undefined, messageId: "<root@x>" });
    const reply = makeMessage({ id: "r2", threadId: "<root@x>" });
    const result = resolveDeleteTargets({
      ...baseParams,
      message: root,
      threadScopeMessages: [root, reply]
    });

    expect(result.kind).toBe("thread");
    expect(result.targets.map((item) => item.id)).toEqual(["r1", "r2"]);
  });
});
