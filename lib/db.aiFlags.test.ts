import { describe, expect, test } from "bun:test";
import type { Account, Folder, Message } from "./data";
import { AI_MODIFIED_FLAG } from "./messageFlags";
import { dbModulePromise } from "./testDbHarness";

const { getMessageById, saveFoldersForAccount, updateMessageFlags, upsertAccount, upsertMessages } =
  await dbModulePromise;

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "AI Flag Test",
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

function buildFolder(accountId: string): Folder {
  return {
    id: `${accountId}-inbox`,
    accountId,
    name: "Inbox",
    count: 0,
    unreadCount: 0,
    specialUse: "\\Inbox"
  };
}

function buildMessage(accountId: string, folderId: string, subject: string): Message {
  return {
    id: `${accountId}-message-1`,
    accountId,
    folderId,
    threadId: `${accountId}-thread-1`,
    messageId: `<${accountId}-message-1@example.test>`,
    subject,
    from: "alice@example.test",
    to: "owner@example.test",
    preview: subject,
    date: new Date(Date.UTC(2026, 2, 26, 12, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 2, 26, 12, 0, 0),
    body: subject,
    mailboxPath: "INBOX",
    imapUid: 77,
    flags: ["\\Seen"]
  };
}

describe("local AI message flags", () => {
  test("preserves the AI-modified flag across message upserts", async () => {
    const accountId = "acc-ai-flag-preserve";
    const folder = buildFolder(accountId);
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);

    await upsertMessages(accountId, folder.id, [buildMessage(accountId, folder.id, "First subject")]);
    await updateMessageFlags(accountId, `${accountId}-message-1`, ["\\Seen", AI_MODIFIED_FLAG]);

    await upsertMessages(accountId, folder.id, [buildMessage(accountId, folder.id, "Updated subject")]);

    const message = await getMessageById(accountId, `${accountId}-message-1`);
    expect(message?.subject).toBe("Updated subject");
    expect(message?.flags).toContain("\\Seen");
    expect(message?.flags).toContain(AI_MODIFIED_FLAG);
  });
});
