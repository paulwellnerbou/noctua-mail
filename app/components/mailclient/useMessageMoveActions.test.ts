import { describe, expect, it } from "bun:test";
import type { Message } from "@/lib/data";
import { shouldKeepMovedMessageVisible } from "./useMessageMoveActions";

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
