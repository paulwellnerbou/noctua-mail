import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account, Folder, Message } from "@/lib/data";
import { dbModulePromise } from "@/lib/testDbHarness";

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Orphaned UID",
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

function buildFolder(id: string, name: string): Folder {
  return { id, accountId: id.split(":")[0] ?? "", name, count: 0 };
}

function buildMessage(params: {
  accountId: string;
  folderId: string;
  mailboxPath: string;
  imapUid: number;
}): Message {
  return {
    id: `${params.accountId}-message`,
    accountId: params.accountId,
    folderId: params.folderId,
    mailboxPath: params.mailboxPath,
    imapUid: params.imapUid,
    threadId: `${params.accountId}-thread`,
    subject: "Orphaned UID fixture",
    from: "sender@example.com",
    to: "owner@example.com",
    preview: "Orphaned UID fixture",
    date: new Date(Date.UTC(2026, 2, 25, 10, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 2, 25, 10, 0, 0),
    body: "Orphaned UID fixture body",
    unread: true,
    seen: false
  };
}

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describe("listFolderMessageUidAndFlagRows — orphaned null-UID rows", () => {
  test("includes a row whose move finalized without ever learning a destination UID", async () => {
    // Reproduces a real stuck state found in a live account: a message
    // moved into Trash, the async move finalized (pending-move markers
    // cleared), but the server's MOVE/COPY response never surfaced a
    // destination UID — so imapUid stayed null with nothing left claiming
    // it. Such a row must be visible to the sync diff so it can finally be
    // reconciled once the remote folder is confirmed not to have it.
    const accountId = uniqueAccountId("acc-orphaned-uid");
    const sourceFolder = buildFolder(`${accountId}:Source`, "Source");
    const trashFolder = buildFolder(`${accountId}:Trash`, "Trash");
    const {
      upsertAccount,
      saveFoldersForAccount,
      upsertMessages,
      stageMessageMoves,
      relocateMovedMessage,
      listFolderMessageUidAndFlagRows
    } = await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [sourceFolder, trashFolder]);
    const message = buildMessage({
      accountId,
      folderId: sourceFolder.id,
      mailboxPath: "Source",
      imapUid: 41
    });
    await upsertMessages(accountId, sourceFolder.id, [message], true);

    await stageMessageMoves({
      accountId,
      messageIds: [message.id],
      destinationFolderId: trashFolder.id,
      destinationMailboxPath: "Trash"
    });
    // Finalize without a destination UID — the exact state that left rows
    // permanently invisible to the stale-row diff before this fix.
    await relocateMovedMessage({
      accountId,
      previousId: message.id,
      destinationFolderId: trashFolder.id,
      destinationMailboxPath: "Trash",
      destinationUid: null
    });

    const rows = await listFolderMessageUidAndFlagRows(accountId, trashFolder.id);
    expect(rows).toEqual([{ id: message.id, imapUid: null, flags: null }]);
  });

  test("excludes a row still mid-move (pending-move marker still claims it)", async () => {
    const accountId = uniqueAccountId("acc-pending-uid");
    const sourceFolder = buildFolder(`${accountId}:Source`, "Source");
    const trashFolder = buildFolder(`${accountId}:Trash`, "Trash");
    const { upsertAccount, saveFoldersForAccount, upsertMessages, stageMessageMoves, listFolderMessageUidAndFlagRows } =
      await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [sourceFolder, trashFolder]);
    const message = buildMessage({
      accountId,
      folderId: sourceFolder.id,
      mailboxPath: "Source",
      imapUid: 41
    });
    await upsertMessages(accountId, sourceFolder.id, [message], true);
    await stageMessageMoves({
      accountId,
      messageIds: [message.id],
      destinationFolderId: trashFolder.id,
      destinationMailboxPath: "Trash"
    });

    const rows = await listFolderMessageUidAndFlagRows(accountId, trashFolder.id);
    expect(rows).toEqual([]);
  });
});
