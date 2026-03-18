import { describe, expect, it } from "bun:test";
import type { Message, Topic } from "@/lib/data";
import { enrichMessagesWithThreadTopics } from "./enrichMessagesWithThreadTopics";

function buildMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: overrides.id ?? "msg-1",
    threadId: overrides.threadId ?? "thread-1",
    subject: overrides.subject ?? "Subject",
    from: overrides.from ?? "sender@example.com",
    to: overrides.to ?? "recipient@example.com",
    preview: overrides.preview ?? "Preview",
    date: overrides.date ?? "2026-03-18T09:00:00.000Z",
    dateValue: overrides.dateValue ?? 1,
    folderId: overrides.folderId ?? "folder-1",
    accountId: overrides.accountId ?? "account-1",
    body: overrides.body ?? "",
    ...overrides
  };
}

function buildTopic(id: string): Topic {
  return {
    id,
    accountId: "account-1",
    name: `Topic ${id}`,
    color: "gray",
    imapKeyword: `topic-${id}`,
    createdAt: 1,
    updatedAt: 1
  };
}

describe("enrichMessagesWithThreadTopics", () => {
  it("attaches topics to every message sharing a thread", async () => {
    const items = [
      buildMessage({ id: "msg-1", threadId: "thread-1" }),
      buildMessage({ id: "msg-2", threadId: "thread-1" }),
      buildMessage({ id: "msg-3", threadId: "thread-2" })
    ];
    const topicA = buildTopic("topic-a");
    const topicB = buildTopic("topic-b");

    await enrichMessagesWithThreadTopics(items, {
      accountId: "account-1",
      loadTopicsForThreads: async () =>
        new Map<string, Topic[]>([
          ["thread-1", [topicA]],
          ["thread-2", [topicB]]
        ])
    });

    expect(items[0].topics).toEqual([topicA]);
    expect(items[1].topics).toEqual([topicA]);
    expect(items[2].topics).toEqual([topicB]);
  });

  it("loads suggestions only for threads without topics", async () => {
    const items = [
      buildMessage({ id: "msg-1", threadId: "thread-1" }),
      buildMessage({ id: "msg-2", threadId: "thread-2" })
    ];
    const topicA = buildTopic("topic-a");
    const suggestion = buildTopic("topic-suggested");
    const suggestionCalls: string[][] = [];

    await enrichMessagesWithThreadTopics(items, {
      accountId: "account-1",
      accountEmail: "me@example.com",
      includeSuggestions: true,
      loadTopicsForThreads: async () =>
        new Map<string, Topic[]>([
          ["thread-1", [topicA]],
          ["thread-2", []]
        ]),
      loadTopicSuggestionsForThreads: async (_accountId, threadIds) => {
        suggestionCalls.push(threadIds);
        return new Map<string, Topic[]>([["thread-2", [suggestion]]]);
      }
    });

    expect(items[0].topics).toEqual([topicA]);
    expect(items[0].topicSuggestions).toBeUndefined();
    expect(items[1].topics).toEqual([]);
    expect(items[1].topicSuggestions).toEqual([suggestion]);
    expect(suggestionCalls).toEqual([["thread-2"]]);
  });
});
