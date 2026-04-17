import { describe, expect, test } from "bun:test";
import type { Folder, Message } from "@/lib/data";
import {
  findTrashFolderIdForAccount,
  isPermanentDeleteTarget
} from "./trashFolder";

function folder(overrides: Partial<Folder> & { id: string; accountId: string }): Folder {
  return {
    name: overrides.id,
    count: 0,
    unreadCount: 0,
    parentId: null,
    specialUse: undefined,
    delimiter: "/",
    ...overrides
  } as Folder;
}

describe("findTrashFolderIdForAccount", () => {
  test("returns the \\Trash folder id for the matching account", () => {
    const folders: Folder[] = [
      folder({ id: "a:INBOX", accountId: "a" }),
      folder({ id: "a:Trash", accountId: "a", specialUse: "\\Trash" })
    ];
    expect(findTrashFolderIdForAccount(folders, "a")).toBe("a:Trash");
  });

  test("matches \\Trash case-insensitively", () => {
    const folders: Folder[] = [
      folder({ id: "a:Trash", accountId: "a", specialUse: "\\trash" })
    ];
    expect(findTrashFolderIdForAccount(folders, "a")).toBe("a:Trash");
  });

  test("tolerates stray whitespace in specialUse (IMAP may return padded values)", () => {
    const folders: Folder[] = [
      folder({ id: "a:Trash", accountId: "a", specialUse: "  \\Trash  " })
    ];
    expect(findTrashFolderIdForAccount(folders, "a")).toBe("a:Trash");
  });

  test("does not match by name — only by specialUse", () => {
    const folders: Folder[] = [
      folder({ id: "a:Trash", accountId: "a", specialUse: undefined }),
      folder({ id: "a:Other", accountId: "a", specialUse: undefined })
    ];
    expect(findTrashFolderIdForAccount(folders, "a")).toBeNull();
  });

  test("scopes to the account — ignores another account's \\Trash", () => {
    const folders: Folder[] = [
      folder({ id: "a:INBOX", accountId: "a" }),
      folder({ id: "b:Trash", accountId: "b", specialUse: "\\Trash" })
    ];
    expect(findTrashFolderIdForAccount(folders, "a")).toBeNull();
  });

  test("returns null for empty folder list", () => {
    expect(findTrashFolderIdForAccount([], "a")).toBeNull();
  });
});

describe("isPermanentDeleteTarget", () => {
  const neverTrash = () => false;

  test("returns true when the target folder matches the resolved trashFolderId", () => {
    const target = { folderId: "a:Trash" } as Message;
    expect(isPermanentDeleteTarget(target, "a:Trash", neverTrash)).toBe(true);
  });

  test("returns true when isTrashFolder predicate says so (cross-account all-scope)", () => {
    const target = { folderId: "b:Trash" } as Message;
    // Resolved trashFolderId is for account 'a' — so it won't match; the
    // predicate owns the cross-account decision.
    const isTrashFolder = (folderId?: string | null) => folderId === "b:Trash";
    expect(isPermanentDeleteTarget(target, "a:Trash", isTrashFolder)).toBe(true);
  });

  test("returns false when neither resolved trashFolderId nor predicate match", () => {
    const target = { folderId: "a:INBOX" } as Message;
    expect(isPermanentDeleteTarget(target, "a:Trash", neverTrash)).toBe(false);
  });

  test("tolerates a null trashFolderId (falls through to predicate)", () => {
    const target = { folderId: "b:Trash" } as Message;
    const isTrashFolder = (folderId?: string | null) => folderId?.endsWith(":Trash") ?? false;
    expect(isPermanentDeleteTarget(target, null, isTrashFolder)).toBe(true);
  });
});
