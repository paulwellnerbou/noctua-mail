import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account, Folder, MailboxState } from "./data";
import { dbModulePromise } from "./testDbHarness";

const { getMailboxState, saveFoldersForAccount, saveMailboxState, upsertAccount } = await dbModulePromise;

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Mailbox State Test",
    email: "owner@example.test",
    avatar: "MS",
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

function buildFolder(accountId: string, name: string): Folder {
  return {
    id: `${accountId}:${name}`,
    accountId,
    name,
    count: 0,
    unreadCount: 0
  };
}

describe("saveMailboxState / getMailboxState", () => {
  test("round-trips a fully populated mailbox state", async () => {
    const accountId = uniqueAccountId("acc-mbx-roundtrip");
    const folder = buildFolder(accountId, "INBOX");
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);

    const state: MailboxState = {
      accountId,
      folderId: folder.id,
      mailboxPath: "INBOX",
      uidValidity: "123",
      highestModSeq: "4567",
      highestUid: 200,
      supportsQresync: true
    };
    await saveMailboxState(state);

    const fetched = await getMailboxState(accountId, folder.id);
    expect(fetched).toEqual({
      accountId,
      folderId: folder.id,
      mailboxPath: "INBOX",
      uidValidity: "123",
      highestModSeq: "4567",
      highestUid: 200,
      supportsQresync: true
    });
  });

  test("returns null when no state has been saved for the folder", async () => {
    const accountId = uniqueAccountId("acc-mbx-missing");
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [buildFolder(accountId, "INBOX")]);

    const state = await getMailboxState(accountId, `${accountId}:INBOX`);
    expect(state).toBeNull();
  });

  test("overwrites existing state for the same folder", async () => {
    const accountId = uniqueAccountId("acc-mbx-overwrite");
    const folder = buildFolder(accountId, "INBOX");
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);

    await saveMailboxState({
      accountId,
      folderId: folder.id,
      mailboxPath: "INBOX",
      uidValidity: "1",
      highestModSeq: "100",
      highestUid: 10,
      supportsQresync: false
    });
    await saveMailboxState({
      accountId,
      folderId: folder.id,
      mailboxPath: "INBOX",
      uidValidity: "2",
      highestModSeq: "200",
      highestUid: 20,
      supportsQresync: true
    });

    const state = await getMailboxState(accountId, folder.id);
    expect(state?.uidValidity).toBe("2");
    expect(state?.highestUid).toBe(20);
    expect(state?.supportsQresync).toBe(true);
  });

  test("coerces supportsQresync from null to null (not false)", async () => {
    const accountId = uniqueAccountId("acc-mbx-null-qresync");
    const folder = buildFolder(accountId, "INBOX");
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);

    await saveMailboxState({
      accountId,
      folderId: folder.id,
      mailboxPath: "INBOX",
      uidValidity: null,
      highestModSeq: null,
      highestUid: null,
      supportsQresync: null
    });

    const state = await getMailboxState(accountId, folder.id);
    expect(state?.supportsQresync).toBeNull();
    expect(state?.highestUid).toBeNull();
  });
});
