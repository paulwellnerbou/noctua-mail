import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account, Folder, Message } from "./data";
import { buildImapMessageRowId } from "./messageIds";
import { dbModulePromise } from "./testDbHarness";

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Same-folder copies",
    email: "owner@example.test",
    avatar: "",
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

function buildFolder(accountId: string, mailboxPath: string): Folder {
  return {
    id: `${accountId}:${mailboxPath}`,
    accountId,
    name: mailboxPath,
    count: 0,
    unreadCount: 0
  };
}

function buildMessage(params: {
  accountId: string;
  folderId: string;
  mailboxPath: string;
  imapUid: number;
  messageId: string;
  subject?: string;
  preview?: string;
}): Message {
  return {
    id: buildImapMessageRowId(params.messageId),
    accountId: params.accountId,
    folderId: params.folderId,
    mailboxPath: params.mailboxPath,
    imapUid: params.imapUid,
    threadId: params.messageId,
    messageId: params.messageId,
    subject: params.subject ?? "Mailbox copy",
    from: "sender@example.test",
    to: "owner@example.test",
    preview: params.preview ?? "Preview",
    date: new Date(Date.UTC(2026, 3, 12, 10, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 3, 12, 10, 0, 0),
    body: "Body",
    unread: true,
    seen: false
  };
}

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describe("upsertMessages same-folder mailbox copies", () => {
  test("keeps same-folder copies with the same Message-ID when IMAP UIDs differ", async () => {
    const accountId = uniqueAccountId("acc-db-same-folder-copies");
    const inbox = buildFolder(accountId, "INBOX");
    const messageId = "<same-folder-copy@example.test>";
    const firstCopy = buildMessage({
      accountId,
      folderId: inbox.id,
      mailboxPath: "INBOX",
      imapUid: 10,
      messageId
    });
    const secondCopy = buildMessage({
      accountId,
      folderId: inbox.id,
      mailboxPath: "INBOX",
      imapUid: 11,
      messageId
    });
    const { getFolders, saveFoldersForAccount, upsertAccount, upsertMessages, withAccountDb } =
      await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [inbox]);
    await upsertMessages(accountId, inbox.id, [firstCopy], true);
    await upsertMessages(accountId, inbox.id, [secondCopy], false);

    const rows = await withAccountDb(accountId, (db) =>
      db
        .prepare(
          `SELECT id, folderId, mailboxPath, imapUid, messageId
           FROM messages
           WHERE accountId = ? AND folderId = ?
           ORDER BY imapUid ASC, id ASC`
        )
        .all(accountId, inbox.id)
    ) as Array<{
      id: string;
      folderId: string;
      mailboxPath: string | null;
      imapUid: number | null;
      messageId: string | null;
    }>;

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.imapUid)).toEqual([10, 11]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    expect(rows.map((row) => row.messageId)).toEqual([messageId, messageId]);

    const folders = await getFolders(accountId);
    expect(folders.find((folder) => folder.id === inbox.id)?.count).toBe(2);
  });

  test("updates the existing row for the same mailbox copy", async () => {
    const accountId = uniqueAccountId("acc-db-same-copy-update");
    const inbox = buildFolder(accountId, "INBOX");
    const messageId = "<same-copy-update@example.test>";
    const original = buildMessage({
      accountId,
      folderId: inbox.id,
      mailboxPath: "INBOX",
      imapUid: 22,
      messageId,
      subject: "Original subject",
      preview: "Original preview"
    });
    const updated = buildMessage({
      accountId,
      folderId: inbox.id,
      mailboxPath: "INBOX",
      imapUid: 22,
      messageId,
      subject: "Updated subject",
      preview: "Updated preview"
    });
    const { saveFoldersForAccount, upsertAccount, upsertMessages, withAccountDb } =
      await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [inbox]);
    await upsertMessages(accountId, inbox.id, [original], true);
    await upsertMessages(accountId, inbox.id, [updated], false);

    const rows = await withAccountDb(accountId, (db) =>
      db
        .prepare(
          `SELECT id, imapUid, subject, preview
           FROM messages
           WHERE accountId = ? AND folderId = ?`
        )
        .all(accountId, inbox.id)
    ) as Array<{
      id: string;
      imapUid: number | null;
      subject: string;
      preview: string;
    }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.imapUid).toBe(22);
    expect(rows[0]?.subject).toBe("Updated subject");
    expect(rows[0]?.preview).toBe("Updated preview");
  });

  test("preserves cross-folder copies with the same Message-ID", async () => {
    const accountId = uniqueAccountId("acc-db-cross-folder-copies");
    const inbox = buildFolder(accountId, "INBOX");
    const sent = buildFolder(accountId, "Sent");
    const messageId = "<cross-folder-copy@example.test>";
    const inboxCopy = buildMessage({
      accountId,
      folderId: inbox.id,
      mailboxPath: "INBOX",
      imapUid: 31,
      messageId
    });
    const sentCopy = buildMessage({
      accountId,
      folderId: sent.id,
      mailboxPath: "Sent",
      imapUid: 31,
      messageId
    });
    const { saveFoldersForAccount, upsertAccount, upsertMessages, withAccountDb } =
      await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [inbox, sent]);
    await upsertMessages(accountId, inbox.id, [inboxCopy], true);
    await upsertMessages(accountId, sent.id, [sentCopy], false);

    const rows = await withAccountDb(accountId, (db) =>
      db
        .prepare(
          `SELECT id, folderId, mailboxPath, imapUid, messageId
           FROM messages
           WHERE accountId = ? AND messageId = ?
           ORDER BY folderId ASC`
        )
        .all(accountId, messageId)
    ) as Array<{
      id: string;
      folderId: string;
      mailboxPath: string | null;
      imapUid: number | null;
      messageId: string | null;
    }>;

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.folderId)).toEqual([inbox.id, sent.id]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });
});
