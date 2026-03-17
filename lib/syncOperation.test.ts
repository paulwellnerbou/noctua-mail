import { describe, expect, test } from "bun:test";
import { resolveOrphanedMessageFileRefs } from "./syncOperation";

describe("resolveOrphanedMessageFileRefs", () => {
  test("treats rows still present in the synced folder as orphaned", () => {
    const orphaned = resolveOrphanedMessageFileRefs({
      removed: [{ messageId: "row-1", attachmentIds: [] }],
      existingFolderIds: new Map([["row-1", "acc:Entwürfe"]]),
      currentFolderId: "acc:Entwürfe"
    });

    expect(orphaned).toEqual([{ messageId: "row-1", attachmentIds: [] }]);
  });

  test("preserves rows that were relocated into another folder", () => {
    const orphaned = resolveOrphanedMessageFileRefs({
      removed: [{ messageId: "row-1", attachmentIds: [] }],
      existingFolderIds: new Map([["row-1", "acc:Archive"]]),
      currentFolderId: "acc:Entwürfe"
    });

    expect(orphaned).toEqual([]);
  });

  test("treats account-wide full sync removals as orphaned", () => {
    const orphaned = resolveOrphanedMessageFileRefs({
      removed: [{ messageId: "row-1", attachmentIds: [] }],
      existingFolderIds: new Map([["row-1", "acc:Archive"]]),
      currentFolderId: null
    });

    expect(orphaned).toEqual([{ messageId: "row-1", attachmentIds: [] }]);
  });
});
