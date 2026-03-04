import { describe, expect, it } from "bun:test";

import type { Message } from "@/lib/data";
import { pruneDetachedCrossFolderThreadMessages } from "./messageMutation";

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

describe("pruneDetachedCrossFolderThreadMessages", () => {
  it("removes cross-folder thread members when no active-folder message remains", () => {
    const sent = makeMessage({
      id: "sent-1",
      folderId: "acc:Sent",
      dateValue: 1000
    });

    const result = pruneDetachedCrossFolderThreadMessages([sent], {
      searchScope: "folder",
      activeFolderId: "acc:INBOX",
      includeThreadAcrossFoldersForList: true
    });

    expect(result).toEqual([]);
  });

  it("keeps cross-folder thread members while an active-folder anchor still exists", () => {
    const inbox = makeMessage({ id: "inbox-1", folderId: "acc:INBOX" });
    const sent = makeMessage({ id: "sent-1", folderId: "acc:Sent", dateValue: 1000 });

    const result = pruneDetachedCrossFolderThreadMessages([inbox, sent], {
      searchScope: "folder",
      activeFolderId: "acc:INBOX",
      includeThreadAcrossFoldersForList: true
    });

    expect(result).toEqual([inbox, sent]);
  });

  it("does not prune when cross-folder thread expansion is disabled", () => {
    const sent = makeMessage({
      id: "sent-1",
      folderId: "acc:Sent",
      dateValue: 1000
    });

    const result = pruneDetachedCrossFolderThreadMessages([sent], {
      searchScope: "folder",
      activeFolderId: "acc:INBOX",
      includeThreadAcrossFoldersForList: false
    });

    expect(result).toEqual([sent]);
  });
});
