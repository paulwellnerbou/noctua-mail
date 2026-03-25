import { beforeAll, describe, expect, test } from "bun:test";
import type { Account, Folder, Message } from "./data";
import { dbModulePromise } from "./testDbHarness";

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Move Test",
    email: "owner@example.com",
    avatar: "",
    imap: {
      host: "imap.example.com",
      port: 993,
      secure: true,
      user: "owner@example.com",
      password: "secret"
    },
    smtp: {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "owner@example.com",
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

function buildMessage(params: {
  accountId: string;
  folderId: string;
  mailboxPath: string;
  imapUid: number;
  unread?: boolean;
}): Message {
  return {
    id: `${params.accountId}-message-1`,
    accountId: params.accountId,
    folderId: params.folderId,
    mailboxPath: params.mailboxPath,
    imapUid: params.imapUid,
    threadId: "thread-1",
    subject: "Bulk move target",
    from: "sender@example.com",
    to: "recipient@example.com",
    preview: "Preview",
    date: new Date(Date.UTC(2026, 2, 25, 10, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 2, 25, 10, 0, 0),
    body: "Body",
    unread: params.unread ?? true,
    seen: !(params.unread ?? true)
  };
}

describe("message move persistence", () => {
  beforeAll(async () => {
    const { upsertAccount } = await dbModulePromise;
    await upsertAccount(buildAccount("acc-move-persistence-bootstrap"));
  });

  test("stageMessageMoves persists pending move metadata", async () => {
    const accountId = "acc-move-persistence-stage";
    const sourceFolder = buildFolder(accountId, "Source");
    const targetFolder = buildFolder(accountId, "Target");
    const message = buildMessage({
      accountId,
      folderId: sourceFolder.id,
      mailboxPath: "Source",
      imapUid: 41
    });
    const {
      upsertAccount,
      saveFoldersForAccount,
      upsertMessages,
      stageMessageMoves,
      getPendingMoveSourceUids,
      hasPendingMovesForFolder,
      withAccountDb
    } = await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [sourceFolder, targetFolder]);
    await upsertMessages(accountId, sourceFolder.id, [message], true);

    const staged = await stageMessageMoves({
      accountId,
      messageIds: [message.id],
      destinationFolderId: targetFolder.id,
      destinationMailboxPath: "Target"
    });

    expect(staged).toEqual([
      {
        messageId: message.id,
        sourceFolderId: sourceFolder.id,
        sourceMailboxPath: "Source",
        sourceUid: 41,
        destinationFolderId: targetFolder.id,
        destinationMailboxPath: "Target"
      }
    ]);

    const stored = await withAccountDb(accountId, (db) =>
      db
        .prepare(
          `SELECT
             folderId,
             mailboxPath,
             imapUid,
             pendingMoveSourceFolderId,
             pendingMoveSourceMailboxPath,
             pendingMoveSourceUid,
             pendingMoveStartedAt
           FROM messages
           WHERE accountId = ? AND id = ?`
        )
        .get(accountId, message.id)
    );

    expect(stored.folderId).toBe(targetFolder.id);
    expect(stored.mailboxPath).toBe("Target");
    expect(stored.imapUid).toBeNull();
    expect(stored.pendingMoveSourceFolderId).toBe(sourceFolder.id);
    expect(stored.pendingMoveSourceMailboxPath).toBe("Source");
    expect(stored.pendingMoveSourceUid).toBe(41);
    expect(typeof stored.pendingMoveStartedAt).toBe("number");
    expect(await getPendingMoveSourceUids(accountId, sourceFolder.id)).toEqual(new Set([41]));
    expect(await hasPendingMovesForFolder(accountId, sourceFolder.id)).toBe(true);
    expect(await hasPendingMovesForFolder(accountId, targetFolder.id)).toBe(true);
  });

  test("updateMessageFolder clears pending move metadata after a successful move", async () => {
    const accountId = "acc-move-persistence-success";
    const sourceFolder = buildFolder(accountId, "Source");
    const targetFolder = buildFolder(accountId, "Target");
    const message = buildMessage({
      accountId,
      folderId: sourceFolder.id,
      mailboxPath: "Source",
      imapUid: 52
    });
    const {
      upsertAccount,
      saveFoldersForAccount,
      upsertMessages,
      stageMessageMoves,
      updateMessageFolder,
      withAccountDb
    } = await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [sourceFolder, targetFolder]);
    await upsertMessages(accountId, sourceFolder.id, [message], true);
    await stageMessageMoves({
      accountId,
      messageIds: [message.id],
      destinationFolderId: targetFolder.id,
      destinationMailboxPath: "Target"
    });

    await updateMessageFolder(accountId, message.id, targetFolder.id, "Target", 2052);

    const stored = await withAccountDb(accountId, (db) =>
      db
        .prepare(
          `SELECT
             folderId,
             mailboxPath,
             imapUid,
             pendingMoveSourceFolderId,
             pendingMoveSourceMailboxPath,
             pendingMoveSourceUid,
             pendingMoveStartedAt
           FROM messages
           WHERE accountId = ? AND id = ?`
        )
        .get(accountId, message.id)
    );

    expect(stored.folderId).toBe(targetFolder.id);
    expect(stored.mailboxPath).toBe("Target");
    expect(stored.imapUid).toBe(2052);
    expect(stored.pendingMoveSourceFolderId).toBeNull();
    expect(stored.pendingMoveSourceMailboxPath).toBeNull();
    expect(stored.pendingMoveSourceUid).toBeNull();
    expect(stored.pendingMoveStartedAt).toBeNull();
  });

  test("updateMessageFolder restores the source folder on rollback", async () => {
    const accountId = "acc-move-persistence-rollback";
    const sourceFolder = buildFolder(accountId, "Source");
    const targetFolder = buildFolder(accountId, "Target");
    const message = buildMessage({
      accountId,
      folderId: sourceFolder.id,
      mailboxPath: "Source",
      imapUid: 88
    });
    const {
      upsertAccount,
      saveFoldersForAccount,
      upsertMessages,
      stageMessageMoves,
      updateMessageFolder,
      withAccountDb
    } = await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [sourceFolder, targetFolder]);
    await upsertMessages(accountId, sourceFolder.id, [message], true);
    await stageMessageMoves({
      accountId,
      messageIds: [message.id],
      destinationFolderId: targetFolder.id,
      destinationMailboxPath: "Target"
    });

    await updateMessageFolder(accountId, message.id, sourceFolder.id, "Source", 88);

    const stored = await withAccountDb(accountId, (db) =>
      db
        .prepare(
          `SELECT
             folderId,
             mailboxPath,
             imapUid,
             pendingMoveSourceFolderId,
             pendingMoveSourceMailboxPath,
             pendingMoveSourceUid,
             pendingMoveStartedAt
           FROM messages
           WHERE accountId = ? AND id = ?`
        )
        .get(accountId, message.id)
    );

    expect(stored.folderId).toBe(sourceFolder.id);
    expect(stored.mailboxPath).toBe("Source");
    expect(stored.imapUid).toBe(88);
    expect(stored.pendingMoveSourceFolderId).toBeNull();
    expect(stored.pendingMoveSourceMailboxPath).toBeNull();
    expect(stored.pendingMoveSourceUid).toBeNull();
    expect(stored.pendingMoveStartedAt).toBeNull();
  });
});
