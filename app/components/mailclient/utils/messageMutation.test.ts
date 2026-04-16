import { describe, expect, it } from "bun:test";

import type { Message } from "@/lib/data";
import {
  computeOptimisticMovedMessage,
  pruneDetachedCrossFolderThreadMessages,
  resolveMoveViewTransition
} from "./messageMutation";

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

describe("computeOptimisticMovedMessage", () => {
  it("returns null when searchScope is 'folder' (message leaves the current list)", () => {
    const msg = makeMessage({ flags: ["\\Seen"] });
    const result = computeOptimisticMovedMessage(msg, {
      movedMessageId: "m2",
      destinationFolderId: "acc:Archive",
      destinationMailbox: "Archive",
      searchScope: "folder"
    });
    expect(result).toBeNull();
  });

  it("returns null when scope is 'all' but destinationFolderId is absent", () => {
    const msg = makeMessage();
    const result = computeOptimisticMovedMessage(msg, {
      movedMessageId: "m2",
      destinationFolderId: null,
      searchScope: "all"
    });
    expect(result).toBeNull();
  });

  it("relocates the message to the destination folder in 'all' scope", () => {
    const msg = makeMessage({
      id: "m1",
      folderId: "acc:INBOX",
      mailboxPath: "INBOX",
      flags: ["\\Seen"]
    });
    const moved = computeOptimisticMovedMessage(msg, {
      movedMessageId: "m2",
      destinationFolderId: "acc:Archive",
      destinationMailbox: "Archive",
      searchScope: "all"
    });
    expect(moved).not.toBeNull();
    expect(moved!.id).toBe("m2");
    expect(moved!.folderId).toBe("acc:Archive");
    expect(moved!.mailboxPath).toBe("Archive");
    expect(moved!.flags).toEqual(["\\Seen"]);
  });

  it("falls back to the original mailboxPath when destination doesn't provide one", () => {
    const msg = makeMessage({ mailboxPath: "INBOX", flags: [] });
    const moved = computeOptimisticMovedMessage(msg, {
      movedMessageId: "m2",
      destinationFolderId: "acc:Archive",
      searchScope: "all"
      // destinationMailbox intentionally omitted
    });
    expect(moved!.mailboxPath).toBe("INBOX");
  });

  it("applies the explicit `flags` override when provided", () => {
    const msg = makeMessage({ flags: ["\\Seen"] });
    const moved = computeOptimisticMovedMessage(msg, {
      movedMessageId: "m2",
      destinationFolderId: "acc:Archive",
      flags: ["\\Seen", "\\Flagged"],
      searchScope: "all"
    });
    expect(new Set(moved!.flags ?? [])).toEqual(new Set(["\\Seen", "\\Flagged"]));
  });
});

describe("resolveMoveViewTransition", () => {
  const makeShouldKeep = (answer: boolean) => () => answer;

  it("returns 'keep' when the viewed message isn't the one being moved", () => {
    const view = makeMessage({ id: "other" });
    const moved = makeMessage({ id: "m2" });
    const t = resolveMoveViewTransition(view, "m1", moved, makeShouldKeep(true));
    expect(t).toEqual({ kind: "keep" });
  });

  it("returns 'clear' when moved is null (folder-scope: message left the list)", () => {
    const view = makeMessage({ id: "m1" });
    const t = resolveMoveViewTransition(view, "m1", null, makeShouldKeep(true));
    expect(t).toEqual({ kind: "clear" });
  });

  it("returns 'clear' when shouldKeepInResults rejects the moved message", () => {
    const view = makeMessage({ id: "m1" });
    const moved = makeMessage({ id: "m2" });
    const t = resolveMoveViewTransition(view, "m1", moved, makeShouldKeep(false));
    expect(t).toEqual({ kind: "clear" });
  });

  it("returns 'retarget' when id changed and the result is still in results", () => {
    const view = makeMessage({ id: "m1" });
    const moved = makeMessage({ id: "m2", folderId: "acc:Archive" });
    const t = resolveMoveViewTransition(view, "m1", moved, makeShouldKeep(true));
    expect(t.kind).toBe("retarget");
    if (t.kind === "retarget") {
      expect(t.nextActiveMessageId).toBe("m2");
      expect(t.nextViewMessage.folderId).toBe("acc:Archive");
    }
  });

  it("returns 'keep' when id is unchanged (flag-only reconcile path)", () => {
    const view = makeMessage({ id: "m1" });
    const moved = makeMessage({ id: "m1", flags: ["\\Seen"] });
    const t = resolveMoveViewTransition(view, "m1", moved, makeShouldKeep(true));
    expect(t).toEqual({ kind: "keep" });
  });

  it("returns 'keep' when view is null (no viewer open)", () => {
    const t = resolveMoveViewTransition(null, "m1", makeMessage(), makeShouldKeep(true));
    expect(t).toEqual({ kind: "keep" });
  });
});
