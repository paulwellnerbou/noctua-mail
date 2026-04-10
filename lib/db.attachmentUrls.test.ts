import { describe, expect, test } from "bun:test";
import { buildAccountAttachmentPath } from "./accountApiPaths";
import type { Account, Folder, Message } from "./data";
import { dbModulePromise } from "./testDbHarness";

const { getMessageById, listThreadMessages, saveFoldersForAccount, upsertAccount, upsertMessages } =
  await dbModulePromise;

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Attachment URL Test",
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

function buildMessage(accountId: string, folderId: string): Message {
  return {
    id: `${accountId}-message-1`,
    accountId,
    folderId,
    threadId: `${accountId}-thread-1`,
    messageId: `<${accountId}-message-1@example.test>`,
    subject: "Calendar invite",
    from: "alice@example.test",
    to: "owner@example.test",
    preview: "Calendar invite",
    date: new Date(Date.UTC(2026, 3, 10, 12, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 3, 10, 12, 0, 0),
    body: "Calendar invite",
    attachments: [
      {
        id: "att-1",
        filename: "invite.ics",
        contentType: "text/calendar",
        size: 1024,
        inline: false,
        url: `/api/attachment?accountId=${accountId}&messageId=${accountId}-message-1&attachmentId=att-1`
      }
    ]
  };
}

describe("attachment URL hydration", () => {
  test("rewrites legacy attachment URLs to the account-scoped route", async () => {
    const accountId = "acc-attachment-url-hydration";
    const folder = buildFolder(accountId);

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);
    await upsertMessages(accountId, folder.id, [buildMessage(accountId, folder.id)], true);

    const expectedUrl = buildAccountAttachmentPath(accountId, `${accountId}-message-1`, "att-1");

    const message = await getMessageById(accountId, `${accountId}-message-1`);
    expect(message?.attachments?.[0]?.url).toBe(expectedUrl);

    const listed = await listThreadMessages({
      accountId,
      threadIds: [`${accountId}-thread-1`]
    });
    expect(listed.items[0]?.attachments?.[0]?.url).toBe(expectedUrl);
  });
});
