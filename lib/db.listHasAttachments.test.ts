import { describe, expect, test } from "bun:test";
import type { Account, Attachment, Folder, Message } from "./data";
import { dbModulePromise } from "./testDbHarness";

const { listMessages, saveFoldersForAccount, upsertAccount, upsertMessages } =
  await dbModulePromise;

const accountId = "acc-list-has-attachments";
const folder: Folder = {
  id: `${accountId}-inbox`,
  accountId,
  name: "Inbox",
  count: 0,
  unreadCount: 0,
  specialUse: "\\Inbox"
};

const account: Account = {
  id: accountId,
  name: "List attachment flag test",
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

function buildMessage(
  key: string,
  attachment: Omit<Attachment, "id" | "url">,
  htmlBody?: string
): Message {
  const id = `${accountId}-${key}`;
  const dateValue = Date.UTC(2026, 10, 20, 12, 0, 0);
  return {
    id,
    accountId,
    folderId: folder.id,
    threadId: `${id}-thread`,
    messageId: `<${id}@example.test>`,
    subject: key,
    from: "alice@example.test",
    to: "owner@example.test",
    preview: key,
    date: new Date(dateValue).toISOString(),
    dateValue,
    body: key,
    htmlBody,
    attachments: [{ id: `${id}-att`, ...attachment }]
  };
}

describe("list hasAttachments", () => {
  test("counts inline parts the HTML body cannot render, like the message view", async () => {
    await upsertAccount(account);
    await saveFoldersForAccount(accountId, [folder]);
    await upsertMessages(
      accountId,
      folder.id,
      [
        buildMessage(
          "inline-pdf",
          { filename: "invoice.pdf", contentType: "application/pdf", size: 50_000, inline: true },
          "<p>See attached</p>"
        ),
        buildMessage("inline-image-plain-text", {
          filename: "photo.jpg",
          contentType: "image/jpeg",
          size: 50_000,
          inline: true
        }),
        buildMessage(
          "inline-image-html",
          { filename: "logo.png", contentType: "image/png", size: 50_000, inline: true },
          '<img src="cid:logo">'
        ),
        buildMessage("regular-attachment", {
          filename: "report.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          size: 50_000,
          inline: false
        })
      ],
      true
    );

    const { items } = await listMessages({
      accountId,
      folderId: folder.id,
      page: 1,
      pageSize: 50
    });
    const flags = Object.fromEntries(items.map((item) => [item.subject, item.hasAttachments]));
    expect(flags).toEqual({
      "inline-pdf": true,
      "inline-image-plain-text": true,
      "inline-image-html": false,
      "regular-attachment": true
    });

    const filtered = await listMessages({
      accountId,
      folderId: folder.id,
      page: 1,
      pageSize: 50,
      attachmentsOnly: true
    });
    expect(filtered.items.map((item) => item.subject).sort()).toEqual([
      "inline-image-plain-text",
      "inline-pdf",
      "regular-attachment"
    ]);
  });
});
