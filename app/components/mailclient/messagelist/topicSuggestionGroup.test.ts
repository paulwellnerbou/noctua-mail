import { describe, expect, it } from "bun:test";
import type { Message, Topic } from "@/lib/data";
import {
  buildTopicSuggestionGroup,
  buildTopicSuggestionGroupKey,
  buildTopicSuggestionRankedMessages,
  isTopicSuggestionGroupKey
} from "./topicSuggestionGroup";

function makeMessage(
  id: string,
  threadId: string,
  dateValue: number
): Message {
  return {
    id,
    accountId: "acc-1",
    folderId: "acc-1:inbox",
    threadId,
    subject: `Subject ${id}`,
    from: "Alice <alice@example.com>",
    to: "Bob <bob@example.com>",
    preview: `Preview ${id}`,
    date: new Date(dateValue).toISOString(),
    dateValue,
    body: ""
  };
}

const topic: Topic = {
  id: "topic-build",
  accountId: "acc-1",
  name: "Build Alerts",
  color: "blue",
  imapKeyword: "noctua-topic-topic-build",
  createdAt: Date.now(),
  updatedAt: Date.now()
};

describe("topicSuggestionGroup helpers", () => {
  it("builds a stable synthetic group key", () => {
    const key = buildTopicSuggestionGroupKey("topic-build");
    expect(key).toBe("topic-suggestions:topic-build");
    expect(isTopicSuggestionGroupKey(key)).toBe(true);
    expect(isTopicSuggestionGroupKey("Today")).toBe(false);
  });

  it("adds suggestion-group metadata and keeps count hidden until loaded", () => {
    const groups = buildTopicSuggestionGroup({
      topic,
      rankedMessages: []
    });

    expect(groups).toEqual([
      expect.objectContaining({
        key: "topic-suggestions:topic-build",
        label: "Build Alerts",
        items: [],
        showCount: false,
        allowToggleWhenEmpty: true,
        variant: "topic-suggestions"
      })
    ]);
  });

  it("applies a stable thread sort rank so earlier suggestions stay above later ones", () => {
    const ranked = buildTopicSuggestionRankedMessages(
      [
        makeMessage("msg-weak", "thread-weak", 200),
        makeMessage("msg-strong", "thread-strong", 100)
      ],
      [
        { threadId: "thread-strong", suggestionScore: 22 },
        { threadId: "thread-weak", suggestionScore: 10 }
      ]
    );

    const sortByThread = new Map(
      ranked.map((message) => [message.threadId, Number(message.threadSortDateValue)])
    );

    expect(sortByThread.get("thread-strong")).toBeGreaterThan(
      sortByThread.get("thread-weak") ?? 0
    );
  });
});
