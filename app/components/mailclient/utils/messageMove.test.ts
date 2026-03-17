import { describe, expect, it } from "bun:test";

import type { Folder, Message } from "@/lib/data";
import { resolveMoveTargetRequest } from "./messageMove";

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

const folders: Folder[] = [
  { id: "acc:INBOX", name: "Inbox", count: 0, accountId: "acc", specialUse: "\\Inbox" },
  { id: "acc:Sent", name: "Sent", count: 0, accountId: "acc", specialUse: "\\Sent" },
  { id: "acc:Drafts", name: "Drafts", count: 0, accountId: "acc", specialUse: "\\Drafts" },
  { id: "acc:Archive", name: "Archive", count: 0, accountId: "acc", specialUse: "\\Archive" }
];

describe("resolveMoveTargetRequest", () => {
  it("moves only current-folder thread messages for a visible thread root", () => {
    const sentRoot = makeMessage({ id: "root", folderId: "acc:Sent" });
    const inboxReply = makeMessage({ id: "reply-1", folderId: "acc:INBOX", dateValue: 1 });
    const archivedReply = makeMessage({ id: "reply-2", folderId: "acc:Archive", dateValue: 2 });

    const result = resolveMoveTargetRequest({
      message: sentRoot,
      origin: "list",
      activeAccountId: "acc",
      searchScope: "folder",
      activeFolderId: "acc:INBOX",
      folders,
      visibleMessages: [{ message: sentRoot, depth: 0, threadId: "thread-1" }],
      threadScopeMessages: [sentRoot, inboxReply, archivedReply]
    });

    expect(result).toEqual({
      messageIds: ["reply-1"],
      threadMove: {
        threadId: "thread-1",
        sourceFolderId: "acc:INBOX"
      }
    });
  });

  it("moves every non-sent, non-draft thread message outside folder scope", () => {
    const inboxRoot = makeMessage({ id: "root", folderId: "acc:INBOX" });
    const archivedReply = makeMessage({ id: "reply-1", folderId: "acc:Archive", dateValue: 1 });
    const sentReply = makeMessage({ id: "reply-2", folderId: "acc:Sent", dateValue: 2 });
    const draftReply = makeMessage({ id: "reply-3", folderId: "acc:Drafts", dateValue: 3 });

    const result = resolveMoveTargetRequest({
      message: inboxRoot,
      origin: "table",
      activeAccountId: "acc",
      searchScope: "all",
      activeFolderId: "",
      folders,
      visibleMessages: [{ message: inboxRoot, depth: 0, threadId: "thread-1" }],
      threadScopeMessages: [inboxRoot, archivedReply, sentReply, draftReply]
    });

    expect(result).toEqual({
      messageIds: ["root", "reply-1"],
      threadMove: {
        threadId: "thread-1"
      }
    });
  });

  it("falls back to the clicked message for thread children", () => {
    const root = makeMessage({ id: "root" });
    const child = makeMessage({ id: "child", parentId: "root", dateValue: 1 });

    const result = resolveMoveTargetRequest({
      message: child,
      origin: "list",
      activeAccountId: "acc",
      searchScope: "folder",
      activeFolderId: "acc:INBOX",
      folders,
      visibleMessages: [
        { message: root, depth: 0, threadId: "thread-1" },
        { message: child, depth: 1, threadId: "thread-1" }
      ],
      threadScopeMessages: [root, child]
    });

    expect(result).toEqual({
      messageIds: ["child"]
    });
  });

  it("keeps thread view moves scoped to the single message", () => {
    const root = makeMessage({ id: "root" });
    const child = makeMessage({ id: "child", parentId: "root", dateValue: 1 });

    const result = resolveMoveTargetRequest({
      message: root,
      origin: "thread",
      activeAccountId: "acc",
      searchScope: "folder",
      activeFolderId: "acc:INBOX",
      folders,
      visibleMessages: [{ message: root, depth: 0, threadId: "thread-1" }],
      threadScopeMessages: [root, child]
    });

    expect(result).toEqual({
      messageIds: ["root"]
    });
  });
});
