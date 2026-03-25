import { describe, expect, it } from "bun:test";
import type { Folder, Message } from "@/lib/data";
import { shouldKeepMovedMessageVisible } from "./useMessageMoveActions";
import { applyFolderTransferCounts } from "./utils/messageMutation";

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

function makeFolder(overrides?: Partial<Folder>): Folder {
  return {
    id: "acc:INBOX",
    accountId: "acc",
    name: "Inbox",
    count: 0,
    unreadCount: 0,
    ...overrides
  };
}

describe("shouldKeepMovedMessageVisible", () => {
  it("keeps a moved thread member visible when current results still allow cross-folder threads", () => {
    const moved = makeMessage({ folderId: "acc:Sent" });

    const result = shouldKeepMovedMessageVisible({
      message: moved,
      searchScope: "folder",
      activeFolderId: "acc:INBOX",
      shouldKeepMessageInResults: () => true
    });

    expect(result).toBe(true);
  });

  it("removes a moved message when current results reject it", () => {
    const moved = makeMessage({ folderId: "acc:Sent" });

    const result = shouldKeepMovedMessageVisible({
      message: moved,
      searchScope: "folder",
      activeFolderId: "acc:INBOX",
      shouldKeepMessageInResults: () => false
    });

    expect(result).toBe(false);
  });

  it("falls back to folder matching when no current-result predicate is provided", () => {
    const moved = makeMessage({ folderId: "acc:Sent" });

    const result = shouldKeepMovedMessageVisible({
      message: moved,
      searchScope: "folder",
      activeFolderId: "acc:INBOX"
    });

    expect(result).toBe(false);
  });
});

describe("applyFolderTransferCounts", () => {
  it("updates source and target unread counts for a large optimistic move", () => {
    const folders = [
      makeFolder({ id: "acc:Source", name: "Source", count: 120, unreadCount: 120 }),
      makeFolder({ id: "acc:Target", name: "Target", count: 0, unreadCount: 0 })
    ];

    const next = applyFolderTransferCounts(
      folders,
      Array.from({ length: 120 }, () => ({
        fromFolderId: "acc:Source",
        toFolderId: "acc:Target",
        unread: true
      }))
    );

    expect(next).toEqual([
      makeFolder({ id: "acc:Source", name: "Source", count: 0, unreadCount: 0 }),
      makeFolder({ id: "acc:Target", name: "Target", count: 120, unreadCount: 120 })
    ]);
  });

  it("ignores no-op transfers within the same folder", () => {
    const folders = [makeFolder({ id: "acc:Source", name: "Source", count: 5, unreadCount: 2 })];

    const next = applyFolderTransferCounts(folders, [
      {
        fromFolderId: "acc:Source",
        toFolderId: "acc:Source",
        unread: true
      }
    ]);

    expect(next).toBe(folders);
  });
});
