import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account, Folder } from "./data";
import { dbModulePromise } from "./testDbHarness";

const { getFolders, saveFoldersForAccount, upsertAccount } = await dbModulePromise;

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Folders Test",
    email: "owner@example.test",
    avatar: "FT",
    imap: {
      host: "imap.example.test",
      port: 993,
      secure: true,
      user: "owner@example.test",
      password: "secret"
    },
    smtp: {
      host: "smtp.example.test",
      port: 465,
      secure: true,
      user: "owner@example.test",
      password: "secret"
    }
  };
}

function buildFolder(accountId: string, name: string, specialUse?: string): Folder {
  return {
    id: `${accountId}:${name}`,
    accountId,
    name,
    count: 0,
    unreadCount: 0,
    specialUse
  };
}

describe("saveFoldersForAccount", () => {
  test("persists folders that can be re-fetched via getFolders(accountId)", async () => {
    const accountId = uniqueAccountId("acc-folders-save");
    await upsertAccount(buildAccount(accountId));

    const folders: Folder[] = [
      buildFolder(accountId, "INBOX", "\\Inbox"),
      buildFolder(accountId, "Sent", "\\Sent"),
      buildFolder(accountId, "Archive")
    ];
    await saveFoldersForAccount(accountId, folders);

    const reloaded = await getFolders(accountId);
    const ids = reloaded.map((f) => f.id).sort();
    expect(ids).toEqual([`${accountId}:Archive`, `${accountId}:INBOX`, `${accountId}:Sent`].sort());

    const inbox = reloaded.find((f) => f.id === `${accountId}:INBOX`);
    expect(inbox?.specialUse).toBe("\\Inbox");
  });

  test("replaces the existing folder set for the account", async () => {
    const accountId = uniqueAccountId("acc-folders-replace");
    await upsertAccount(buildAccount(accountId));

    await saveFoldersForAccount(accountId, [
      buildFolder(accountId, "INBOX"),
      buildFolder(accountId, "Trash")
    ]);
    await saveFoldersForAccount(accountId, [buildFolder(accountId, "INBOX")]);

    const reloaded = await getFolders(accountId);
    expect(reloaded.map((f) => f.name)).toEqual(["INBOX"]);
  });

  test("accepts an empty folder list", async () => {
    const accountId = uniqueAccountId("acc-folders-empty");
    await upsertAccount(buildAccount(accountId));

    await saveFoldersForAccount(accountId, [buildFolder(accountId, "INBOX")]);
    await saveFoldersForAccount(accountId, []);
    const reloaded = await getFolders(accountId);
    expect(reloaded).toEqual([]);
  });
});

describe("getFolders", () => {
  test("scopes results to the requested account when an accountId is provided", async () => {
    const accountA = uniqueAccountId("acc-folders-scope-a");
    const accountB = uniqueAccountId("acc-folders-scope-b");
    await upsertAccount(buildAccount(accountA));
    await upsertAccount(buildAccount(accountB));
    await saveFoldersForAccount(accountA, [buildFolder(accountA, "A-Inbox")]);
    await saveFoldersForAccount(accountB, [buildFolder(accountB, "B-Inbox")]);

    const foldersA = await getFolders(accountA);
    expect(foldersA.map((f) => f.name)).toEqual(["A-Inbox"]);

    const foldersB = await getFolders(accountB);
    expect(foldersB.map((f) => f.name)).toEqual(["B-Inbox"]);
  });

  test("returns folders across all accounts when no accountId is provided", async () => {
    const accountId = uniqueAccountId("acc-folders-global");
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [buildFolder(accountId, "Global-Inbox")]);

    const all = await getFolders();
    const hit = all.find((f) => f.id === `${accountId}:Global-Inbox`);
    expect(hit).toBeDefined();
  });
});
