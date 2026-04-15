import { describe, expect, it } from "bun:test";
import type { Folder } from "./data";
import {
  findArchiveFolder,
  findDraftsFolder,
  findInboxFolder,
  findJunkFolder,
  findSentFolder,
  findTrashFolder,
  getFolderSpecialKind,
  isDraftsFolder,
  isNotificationSuppressedFolder,
  isSentFolder,
  isSentFolderRecord,
  isSpamFolder,
  isThreadExcludedFolder,
  isTrashFolder
} from "./specialFolders";

function folder(overrides: Partial<Folder> = {}): Folder {
  // Neutral default name so tests that pass only `specialUse` don't accidentally
  // trip the getFolderSpecialKind name fallbacks ("inbox"/"sent"/"drafts"/etc.).
  return {
    id: overrides.id ?? "folder-1",
    accountId: overrides.accountId ?? "acc-1",
    name: overrides.name ?? "Some Folder",
    count: 0,
    unreadCount: 0,
    ...overrides
  };
}

describe("specialFolders — find*Folder queries", () => {
  it("finds drafts by specialUse, exact name, id fragment, and partial name", () => {
    const byKind = folder({ id: "acc-1:Drafts", specialUse: "\\Drafts" });
    const byExact = folder({ id: "acc-1:entwuerfe", name: "Entwuerfe" });
    const byIdFragment = folder({ id: "acc-1:My-Drafts-2025", name: "My 2025 stuff" });
    const byPartialName = folder({ id: "acc-1:outbox", name: "Draft queue" });
    const nonDrafts = folder({ id: "acc-1:sent", name: "Sent" });

    expect(findDraftsFolder([byKind, nonDrafts], "acc-1")).toBe(byKind);
    expect(findDraftsFolder([byExact, nonDrafts], "acc-1")).toBe(byExact);
    expect(findDraftsFolder([byIdFragment, nonDrafts], "acc-1")).toBe(byIdFragment);
    expect(findDraftsFolder([byPartialName, nonDrafts], "acc-1")).toBe(byPartialName);
  });

  it("restricts find queries to the requested account", () => {
    const drafts = folder({ accountId: "acc-1", specialUse: "\\Drafts" });
    const otherAccount = folder({ accountId: "acc-2", specialUse: "\\Drafts" });
    expect(findDraftsFolder([drafts, otherAccount], "acc-2")).toBe(otherAccount);
    expect(findDraftsFolder([otherAccount], "acc-1")).toBeNull();
  });

  it("exposes finders for trash / inbox / sent / archive / junk", () => {
    const trash = folder({ specialUse: "\\Trash" });
    const inbox = folder({ name: "Inbox" });
    const sent = folder({ name: "Gesendet" });
    const archive = folder({ name: "Archive" });
    const junk = folder({ name: "Junk Email" });
    expect(findTrashFolder([trash], "acc-1")).toBe(trash);
    expect(findInboxFolder([inbox], "acc-1")).toBe(inbox);
    expect(findSentFolder([sent], "acc-1")).toBe(sent);
    expect(findArchiveFolder([archive], "acc-1")).toBe(archive);
    expect(findJunkFolder([junk], "acc-1")).toBe(junk);
  });
});

describe("specialFolders — getFolderSpecialKind", () => {
  it("classifies by specialUse with a narrow name fallback", () => {
    expect(getFolderSpecialKind(folder({ specialUse: "\\Inbox" }))).toBe("inbox");
    expect(getFolderSpecialKind(folder({ name: "inbox" }))).toBe("inbox");
    expect(getFolderSpecialKind(folder({ specialUse: "\\Sent" }))).toBe("sent");
    expect(getFolderSpecialKind(folder({ name: "sent" }))).toBe("sent");
    expect(getFolderSpecialKind(folder({ specialUse: "\\Drafts" }))).toBe("drafts");
    expect(getFolderSpecialKind(folder({ name: "drafts" }))).toBe("drafts");
    expect(getFolderSpecialKind(folder({ specialUse: "\\Trash" }))).toBe("trash");
    expect(getFolderSpecialKind(folder({ specialUse: "\\Junk" }))).toBe("spam");
    expect(getFolderSpecialKind(folder({ specialUse: "\\Spam" }))).toBe("spam");
    expect(getFolderSpecialKind(folder({ name: "junk" }))).toBe("spam");
    expect(getFolderSpecialKind(folder({ specialUse: "\\Archive" }))).toBe("archive");
    expect(getFolderSpecialKind(folder({ name: "archive" }))).toBe("archive");
  });

  it("returns null for folders that do not match any known role", () => {
    expect(getFolderSpecialKind(folder({ name: "Projects" }))).toBeNull();
    expect(getFolderSpecialKind(null)).toBeNull();
    expect(getFolderSpecialKind(undefined)).toBeNull();
  });

  it("classifies 'trash' ONLY by specialUse — a folder named 'Trash' without the attribute is not classified", () => {
    // Intentional: destructive role, prefer false-negative over false-positive.
    expect(getFolderSpecialKind(folder({ name: "Trash" }))).toBeNull();
  });
});

describe("specialFolders — id-based predicates", () => {
  const folders: Folder[] = [
    folder({ id: "f-drafts", specialUse: "\\Drafts", name: "Drafts" }),
    folder({ id: "f-drafts-named", name: "Drafts" }), // no specialUse
    folder({ id: "f-trash", specialUse: "\\Trash" }),
    folder({ id: "f-trash-named", name: "Trash" }), // no specialUse
    folder({ id: "f-junk", specialUse: "\\Junk" }),
    folder({ id: "f-spam", specialUse: "\\Spam" }),
    folder({ id: "f-spam-named", name: "Bulk Spam" }),
    folder({ id: "f-sent", specialUse: "\\Sent" }),
    folder({ id: "f-sent-named", name: "sent" }),
    folder({ id: "f-plain", name: "Projects" })
  ];

  it("isDraftsFolder is strict — requires specialUse '\\Drafts'", () => {
    expect(isDraftsFolder("f-drafts", folders)).toBe(true);
    expect(isDraftsFolder("f-drafts-named", folders)).toBe(false);
    expect(isDraftsFolder("f-plain", folders)).toBe(false);
    expect(isDraftsFolder(null, folders)).toBe(false);
    expect(isDraftsFolder("nonexistent", folders)).toBe(false);
  });

  it("isTrashFolder is strict — requires specialUse '\\Trash'", () => {
    expect(isTrashFolder("f-trash", folders)).toBe(true);
    // Intentional: a folder *named* "Trash" without the attribute is NOT a trash folder.
    expect(isTrashFolder("f-trash-named", folders)).toBe(false);
  });

  it("isSpamFolder is permissive — accepts '\\Junk'/'\\Spam' OR 'junk'/'spam' in name", () => {
    expect(isSpamFolder("f-junk", folders)).toBe(true);
    expect(isSpamFolder("f-spam", folders)).toBe(true);
    expect(isSpamFolder("f-spam-named", folders)).toBe(true);
    expect(isSpamFolder("f-plain", folders)).toBe(false);
  });

  it("isSentFolder mirrors getFolderSpecialKind — specialUse OR exact name 'sent'", () => {
    expect(isSentFolder("f-sent", folders)).toBe(true);
    expect(isSentFolder("f-sent-named", folders)).toBe(true);
    expect(isSentFolder("f-plain", folders)).toBe(false);
    expect(isSentFolderRecord(folders[7])).toBe(true);
  });

  it("isNotificationSuppressedFolder ORs the four role predicates", () => {
    expect(isNotificationSuppressedFolder("f-drafts", folders)).toBe(true);
    expect(isNotificationSuppressedFolder("f-trash", folders)).toBe(true);
    expect(isNotificationSuppressedFolder("f-junk", folders)).toBe(true);
    expect(isNotificationSuppressedFolder("f-sent", folders)).toBe(true);
    expect(isNotificationSuppressedFolder("f-plain", folders)).toBe(false);
  });

  it("isThreadExcludedFolder is specialUse-only for trash/junk/spam", () => {
    expect(isThreadExcludedFolder("f-trash", folders)).toBe(true);
    expect(isThreadExcludedFolder("f-junk", folders)).toBe(true);
    expect(isThreadExcludedFolder("f-spam", folders)).toBe(true);
    // Different from isSpamFolder: a folder *named* "spam" without the attribute is NOT excluded.
    expect(isThreadExcludedFolder("f-spam-named", folders)).toBe(false);
    expect(isThreadExcludedFolder("f-drafts", folders)).toBe(false);
    expect(isThreadExcludedFolder(null, folders)).toBe(false);
  });
});
