import { describe, expect, it, mock } from "bun:test";
import { applyActiveTopicSuggestion } from "./topicSuggestionActions";

describe("applyActiveTopicSuggestion", () => {
  it("persists the topic assignment and refreshes the list and suggestions", async () => {
    const calls: string[] = [];
    const persistThreadTopics = mock(async (threadId: string, topicIds: string[]) => {
      calls.push(`persist:${threadId}:${topicIds.join(",")}`);
    });
    const refreshMailboxData = mock(async () => {
      calls.push("refresh-list");
      return true;
    });
    const refreshSuggestions = mock(async () => {
      calls.push("refresh-suggestions");
    });

    await applyActiveTopicSuggestion({
      threadId: "thread-123",
      topicId: "topic-abc",
      persistThreadTopics,
      refreshMailboxData,
      refreshSuggestions
    });

    expect(calls).toEqual([
      "persist:thread-123:topic-abc",
      "refresh-list",
      "refresh-suggestions"
    ]);
  });
});
