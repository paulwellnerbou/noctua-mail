import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import { buildAccountAttachmentPath } from "./accountApiPaths";
import type { Account, Folder, Message } from "./data";
import { buildImapMessageRowId } from "./messageIds";
import { dbModulePromise } from "./testDbHarness";

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Collision variant inline images",
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

describe("upsertMessages collision-variant inline image URLs", () => {
  // A self-sent message lands in both Sent and INBOX with the same Message-ID,
  // so the second mailbox copy gets a collision-variant row id. Sanitization
  // baked the base row id into the htmlBody's inline <img src> before this
  // upsert assigned the variant; the stored htmlBody must be rewritten to the
  // variant id or the inline image 404s and renders a broken+correct pair.
  test("rewrites the inline image path segment to the variant row id", async () => {
    const accountId = `acc-collision-inline-${randomUUID()}`;
    const inbox = buildFolder(accountId, "INBOX");
    const sent = buildFolder(accountId, "Sent");
    const messageId = "<collision-inline@example.test>";
    const baseRowId = buildImapMessageRowId(messageId);
    // Attachment ids encode the per-mailbox IMAP UID, so the two copies carry
    // distinct ids; the row id is what collides.
    const sentAttachmentId = `att-${accountId}-1444-0`;
    const inboxAttachmentId = `att-${accountId}-82767-0`;

    const common = {
      accountId,
      threadId: messageId,
      messageId,
      subject: "Test-Mail",
      from: "owner@example.test",
      to: "owner@example.test",
      preview: "Test-Bild",
      date: new Date(Date.UTC(2026, 5, 30, 8, 21, 33)).toISOString(),
      dateValue: Date.UTC(2026, 5, 30, 8, 21, 33),
      body: "Test-Bild",
      unread: true,
      seen: false
    };

    const buildCopy = (
      folderId: string,
      mailboxPath: string,
      imapUid: number,
      attachmentId: string
    ): Message => {
      const baseAttachmentUrl = buildAccountAttachmentPath(accountId, baseRowId, attachmentId);
      return {
        ...common,
        id: baseRowId,
        folderId,
        mailboxPath,
        imapUid,
        htmlBody: `<p><img src="${baseAttachmentUrl}" alt="image.png"></p>`,
        attachments: [
          {
            id: attachmentId,
            filename: "image.png",
            contentType: "image/png",
            size: 421282,
            inline: true,
            cid: "inline-abc@noctua",
            url: baseAttachmentUrl
          }
        ]
      };
    };
    const inboxCopy = buildCopy(inbox.id, "INBOX", 82767, inboxAttachmentId);
    const sentCopy = buildCopy(sent.id, "Sent", 1444, sentAttachmentId);

    const { saveFoldersForAccount, upsertAccount, upsertMessages, withAccountDb } =
      await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [inbox, sent]);
    // Sent copy first keeps the base id; the INBOX copy then collides and is
    // assigned the variant id.
    await upsertMessages(accountId, sent.id, [sentCopy], false);
    await upsertMessages(accountId, inbox.id, [inboxCopy], false);

    const rows = (await withAccountDb(accountId, (db) =>
      db
        .prepare(
          `SELECT m.id, m.folderId, m.htmlBody, a.url AS attachmentUrl
           FROM messages m
           LEFT JOIN attachments a ON a.messageId = m.id
           WHERE m.accountId = ?
           ORDER BY m.folderId ASC`
        )
        .all(accountId)
    )) as Array<{
      id: string;
      folderId: string;
      htmlBody: string | null;
      attachmentUrl: string | null;
    }>;

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    for (const row of rows) {
      const ownSegment = `/messages/${encodeURIComponent(row.id)}/attachments/`;
      expect(row.htmlBody).toContain(ownSegment);
      expect(row.attachmentUrl).toContain(ownSegment);
      // No stale base-id path lingers when the row got a variant id.
      if (row.id !== baseRowId) {
        expect(row.htmlBody).not.toContain(`/messages/${baseRowId}/attachments/`);
        expect(row.attachmentUrl).not.toContain(`/messages/${baseRowId}/attachments/`);
      }
    }
  });
});
