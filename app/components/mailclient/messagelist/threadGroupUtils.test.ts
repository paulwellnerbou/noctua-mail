import { describe, expect, it } from "bun:test";
import type { Message } from "@/lib/data";
import { buildThreadTree, flattenThread, getThreadLatestDate } from "./threadTree";
import { buildThreadGroupEntries } from "./threadGroupUtils";

function makeMessage(
  id: string,
  threadId: string,
  dateValue: number,
  overrides?: Partial<Message>
): Message {
  return {
    id,
    threadId,
    subject: `Subject ${id}`,
    from: "Alice <alice@example.com>",
    to: "Bob <bob@example.com>",
    preview: `Preview ${id}`,
    date: new Date(dateValue).toISOString(),
    dateValue,
    folderId: "acc-1:INBOX",
    accountId: "acc-1",
    body: "",
    ...overrides
  };
}

describe("buildThreadGroupEntries", () => {
  it("sorts thread groups by threadSortDateValue when present", () => {
    const olderByReceivedButNewerByActivity = [
      makeMessage("a1", "thread-a", 100, { threadSortDateValue: 100 }),
      makeMessage("a2", "thread-a", 200, { threadSortDateValue: 100, parentId: "a1" })
    ];
    const newerByReceived = [
      makeMessage("b1", "thread-b", 120, { threadSortDateValue: 150 }),
      makeMessage("b2", "thread-b", 150, { threadSortDateValue: 150, parentId: "b1" })
    ];
    const group = {
      key: "Today",
      label: "Today",
      items: [...olderByReceivedButNewerByActivity, ...newerByReceived]
    };

    const entries = buildThreadGroupEntries({
      group,
      collapsedThreads: {},
      includeThreadAcrossFolders: false,
      searchScope: "folder",
      activeFolderId: "acc-1:INBOX",
      buildThreadTree,
      flattenThread,
      getThreadLatestDate
    });

    expect(entries[0]?.threadGroupId).toBe("thread-b");
    expect(entries[1]?.threadGroupId).toBe("thread-a");
  });
});
