import { describe, expect, it } from "bun:test";

import type { Folder } from "@/lib/data";
import { prioritizeFolderIds, prioritizeFolders } from "./folderHelpers";

const folders: Folder[] = [
  { id: "acc:Archive", name: "Archive", count: 0, accountId: "acc" },
  { id: "acc:Projects", name: "Projects", count: 0, accountId: "acc" },
  { id: "acc:INBOX", name: "Inbox", count: 0, accountId: "acc", specialUse: "\\Inbox" },
  { id: "acc:Receipts", name: "Receipts", count: 0, accountId: "acc" }
];

describe("prioritizeFolderIds", () => {
  it("moves priority folders to the front while preserving the remaining order", () => {
    expect(
      prioritizeFolderIds(
        ["acc:Archive", "acc:Projects", "acc:INBOX", "acc:Receipts"],
        ["acc:INBOX", "acc:Projects"]
      )
    ).toEqual(["acc:INBOX", "acc:Projects", "acc:Archive", "acc:Receipts"]);
  });

  it("ignores missing and duplicate priorities", () => {
    expect(
      prioritizeFolderIds(
        ["acc:Archive", "acc:INBOX", "acc:Receipts"],
        ["acc:INBOX", "acc:INBOX", "acc:Missing", null]
      )
    ).toEqual(["acc:INBOX", "acc:Archive", "acc:Receipts"]);
  });
});

describe("prioritizeFolders", () => {
  it("returns folders in the same inbox-first order as prioritizeFolderIds", () => {
    expect(prioritizeFolders(folders, ["acc:INBOX", "acc:Projects"]).map((folder) => folder.id)).toEqual([
      "acc:INBOX",
      "acc:Projects",
      "acc:Archive",
      "acc:Receipts"
    ]);
  });
});
