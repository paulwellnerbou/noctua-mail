import { describe, expect, it } from "bun:test";
import type { Message } from "@/lib/data";
import { buildMessageListItems, type MessageGroup } from "./listModel";

function makeMessage(id: string, threadId: string, dateValue: number): Message {
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

describe("buildMessageListItems", () => {
  it("emits topic suggestions as a dedicated section item instead of group plus sibling rows", () => {
    const suggestionGroup: MessageGroup = {
      key: "topic-suggestions:topic-build",
      label: "Build Alerts",
      items: [
        makeMessage("m1", "thread-1", 1000),
        makeMessage("m2", "thread-2", 900)
      ],
      showCount: false,
      allowToggleWhenEmpty: true,
      variant: "topic-suggestions"
    };
    const normalGroup: MessageGroup = {
      key: "Today",
      label: "Today",
      items: [makeMessage("m3", "thread-3", 800)]
    };

    const items = buildMessageListItems({
      groupedMessages: [suggestionGroup, normalGroup],
      collapsedGroups: {
        "topic-suggestions:topic-build": false,
        Today: false
      },
      collapsedThreads: {},
      supportsThreads: false,
      includeThreadAcrossFolders: false,
      searchScope: "folder",
      activeFolderId: "acc-1:inbox",
      buildThreadTree: () => [],
      flattenThread: () => [],
      getThreadLatestDate: () => 0,
      preferToDisplay: false,
      mode: "flat"
    });

    expect(items.map((item) => item.type)).toEqual([
      "suggestion-section",
      "group",
      "row"
    ]);
    expect(items[0]).toEqual(
      expect.objectContaining({
        type: "suggestion-section",
        key: "topic-suggestions:topic-build:section",
        isCollapsed: false
      })
    );
    if (items[0]?.type !== "suggestion-section") {
      throw new Error("Expected suggestion-section item");
    }
    expect(items[0].rows).toHaveLength(2);
    expect(items[1]).toEqual(
      expect.objectContaining({
        type: "group",
        key: "Today"
      })
    );
  });

  it("still emits normal threaded rows for non-suggestion groups", () => {
    const normalGroup: MessageGroup = {
      key: "Today",
      label: "Today",
      items: [
        makeMessage("root", "thread-1", 1000),
        makeMessage("reply", "thread-1", 900)
      ]
    };

    const items = buildMessageListItems({
      groupedMessages: [normalGroup],
      collapsedGroups: { Today: false },
      collapsedThreads: { "thread-1": false },
      supportsThreads: true,
      includeThreadAcrossFolders: false,
      searchScope: "folder",
      activeFolderId: "acc-1:inbox",
      buildThreadTree: (messages) => [{
        message: messages[0]!,
        children: [
          {
            message: messages[1]!,
            children: []
          }
        ]
      }],
      flattenThread: (node, depth = 0) => [
        { message: node.message, depth },
        ...node.children.flatMap((child) => [
          { message: child.message, depth: depth + 1 }
        ])
      ],
      getThreadLatestDate: (node) => node.message.dateValue,
      preferToDisplay: false,
      mode: "nested"
    });

    expect(items.map((item) => item.type)).toEqual(["group", "row", "row"]);
  });
});
