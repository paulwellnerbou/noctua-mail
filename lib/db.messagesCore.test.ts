import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account, Folder, Message } from "./data";
import { dbModulePromise } from "./testDbHarness";

const {
  getLatestMessageUid,
  getMessageById,
  saveFoldersForAccount,
  updateMessageFlags,
  upsertAccount,
  upsertMessages
} = await dbModulePromise;

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Messages Core Test",
    email: "owner@example.test",
    avatar: "MC",
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

function buildFolder(accountId: string, name = "INBOX"): Folder {
  return {
    id: `${accountId}:${name}`,
    accountId,
    name,
    count: 0,
    unreadCount: 0,
    specialUse: name === "INBOX" ? "\\Inbox" : undefined
  };
}

function buildMessage(params: {
  accountId: string;
  folderId: string;
  id: string;
  messageId: string;
  mailboxPath?: string;
  imapUid?: number;
  subject?: string;
  flags?: string[];
}): Message {
  return {
    id: params.id,
    accountId: params.accountId,
    folderId: params.folderId,
    mailboxPath: params.mailboxPath ?? "INBOX",
    imapUid: params.imapUid,
    threadId: `thread-${params.id}`,
    messageId: params.messageId,
    subject: params.subject ?? "Subject",
    from: "alice@example.test",
    to: "owner@example.test",
    preview: "preview",
    date: new Date(Date.UTC(2026, 3, 14, 10, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 3, 14, 10, 0, 0),
    body: "body",
    flags: params.flags ?? ["\\Seen"]
  };
}

describe("getMessageById", () => {
  test("returns the message when looked up by its row id", async () => {
    const accountId = uniqueAccountId("acc-msg-id");
    const folder = buildFolder(accountId);
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);
    await upsertMessages(accountId, folder.id, [
      buildMessage({
        accountId,
        folderId: folder.id,
        id: "row-42",
        messageId: "<msg-42@example.test>",
        imapUid: 42,
        subject: "Hello"
      })
    ]);

    const message = await getMessageById(accountId, "row-42");
    expect(message).not.toBeNull();
    expect(message?.id).toBe("row-42");
    expect(message?.subject).toBe("Hello");
    expect(message?.from).toBe("alice@example.test");
  });

  test("falls back to a case-insensitive Message-ID lookup", async () => {
    const accountId = uniqueAccountId("acc-msg-fallback");
    const folder = buildFolder(accountId);
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);
    await upsertMessages(accountId, folder.id, [
      buildMessage({
        accountId,
        folderId: folder.id,
        id: "row-case",
        messageId: "<Mixed-Case@example.test>",
        imapUid: 99,
        subject: "Case test"
      })
    ]);

    const message = await getMessageById(accountId, "<mixed-case@example.test>");
    expect(message?.id).toBe("row-case");
  });

  test("returns null when the message is absent", async () => {
    const accountId = uniqueAccountId("acc-msg-none");
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [buildFolder(accountId)]);
    const missing = await getMessageById(accountId, "nonexistent-id");
    expect(missing).toBeNull();
  });
});

describe("getLatestMessageUid", () => {
  test("returns the highest imapUid across all folders for the account", async () => {
    const accountId = uniqueAccountId("acc-latest-all");
    const inbox = buildFolder(accountId, "INBOX");
    const sent = buildFolder(accountId, "Sent");
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [inbox, sent]);
    await upsertMessages(accountId, inbox.id, [
      buildMessage({
        accountId,
        folderId: inbox.id,
        id: "row-latest-1",
        messageId: "<latest-1@example.test>",
        imapUid: 7
      })
    ]);
    await upsertMessages(accountId, sent.id, [
      buildMessage({
        accountId,
        folderId: sent.id,
        id: "row-latest-2",
        messageId: "<latest-2@example.test>",
        mailboxPath: "Sent",
        imapUid: 42
      })
    ]);

    const latest = await getLatestMessageUid(accountId);
    expect(latest).toBe(42);
  });

  test("scopes the lookup to a specific mailboxPath when provided", async () => {
    const accountId = uniqueAccountId("acc-latest-scoped");
    const inbox = buildFolder(accountId, "INBOX");
    const sent = buildFolder(accountId, "Sent");
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [inbox, sent]);
    await upsertMessages(accountId, inbox.id, [
      buildMessage({
        accountId,
        folderId: inbox.id,
        id: "row-scoped-1",
        messageId: "<scoped-1@example.test>",
        imapUid: 55
      })
    ]);
    await upsertMessages(accountId, sent.id, [
      buildMessage({
        accountId,
        folderId: sent.id,
        id: "row-scoped-2",
        messageId: "<scoped-2@example.test>",
        mailboxPath: "Sent",
        imapUid: 999
      })
    ]);

    expect(await getLatestMessageUid(accountId, "INBOX")).toBe(55);
    expect(await getLatestMessageUid(accountId, "Sent")).toBe(999);
  });

  test("returns null when no messages exist", async () => {
    const accountId = uniqueAccountId("acc-latest-empty");
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [buildFolder(accountId)]);
    expect(await getLatestMessageUid(accountId)).toBeNull();
    expect(await getLatestMessageUid(accountId, "INBOX")).toBeNull();
  });
});

describe("updateMessageFlags", () => {
  test("persists normalized flags and derived system flag booleans", async () => {
    const accountId = uniqueAccountId("acc-flags-update");
    const folder = buildFolder(accountId);
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);
    await upsertMessages(accountId, folder.id, [
      buildMessage({
        accountId,
        folderId: folder.id,
        id: "row-flags-1",
        messageId: "<flags-1@example.test>",
        imapUid: 1,
        flags: []
      })
    ]);

    await updateMessageFlags(accountId, "row-flags-1", ["\\Seen", "\\Flagged"]);

    const message = await getMessageById(accountId, "row-flags-1");
    expect(message?.flags).toContain("\\Seen");
    expect(message?.flags).toContain("\\Flagged");
    expect(message?.seen).toBe(true);
    expect(message?.flagged).toBe(true);
    expect(message?.unread).toBe(false);
  });

  test("clearing \\Seen marks the message as unread", async () => {
    const accountId = uniqueAccountId("acc-flags-clear-seen");
    const folder = buildFolder(accountId);
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);
    await upsertMessages(accountId, folder.id, [
      buildMessage({
        accountId,
        folderId: folder.id,
        id: "row-flags-2",
        messageId: "<flags-2@example.test>",
        imapUid: 2,
        flags: ["\\Seen"]
      })
    ]);

    await updateMessageFlags(accountId, "row-flags-2", []);

    const message = await getMessageById(accountId, "row-flags-2");
    expect(message?.seen).toBe(false);
    expect(message?.unread).toBe(true);
    expect(message?.flags ?? []).not.toContain("\\Seen");
  });
});
