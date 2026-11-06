import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account, Attachment, Folder, Message } from "@/lib/data";
import { sealSession, type SessionData } from "@/lib/auth";
import { dbModulePromise } from "@/lib/testDbHarness";

const { saveFoldersForAccount, upsertAccount, upsertMessages } = await dbModulePromise;
const { GET } = await import("./route");

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Attachment Route Test",
    email: "owner@example.test",
    avatar: "",
    imap: {
      host: "imap.example.test",
      port: 993,
      secure: true,
      user: "owner@example.test",
      password: "secret-imap"
    },
    smtp: {
      host: "smtp.example.test",
      port: 465,
      secure: true,
      user: "owner@example.test",
      password: "secret-smtp"
    }
  };
}

function buildFolder(accountId: string): Folder {
  return {
    id: `${accountId}:INBOX`,
    accountId,
    name: "INBOX",
    count: 1,
    unreadCount: 0,
    specialUse: "\\Inbox"
  };
}

function buildMessage(accountId: string, folderId: string, attachments: Attachment[]): Message {
  return {
    id: `imap-${accountId}-1`,
    accountId,
    folderId,
    threadId: `${accountId}-thread-1`,
    subject: "Attachment test",
    from: "sender@example.test",
    to: "owner@example.test",
    preview: "",
    date: new Date(Date.UTC(2026, 10, 6, 9, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 10, 6, 9, 0, 0),
    body: "",
    mailboxPath: "INBOX",
    imapUid: 1,
    attachments,
    unread: false,
    flags: [],
    seen: true,
    answered: false,
    flagged: false,
    deleted: false,
    draft: false,
    recent: false,
    hasSource: false
  };
}

function cookieFor(accountId: string) {
  const session: SessionData = {
    userId: "user-attachment-route",
    accountId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60
  };
  return `noctua_session=${encodeURIComponent(sealSession(session))}`;
}

async function seedAttachments(attachments: Attachment[]) {
  const accountId = `acc-attachment-route-${randomUUID()}`;
  const folder = buildFolder(accountId);
  const message = buildMessage(accountId, folder.id, attachments);
  await upsertAccount(buildAccount(accountId));
  await saveFoldersForAccount(accountId, [folder]);
  await upsertMessages(accountId, folder.id, [message]);
  return { accountId, messageId: message.id };
}

async function fetchPreviewShell(accountId: string, messageId: string, attachmentId: string) {
  const path = `/api/accounts/${accountId}/messages/${messageId}/attachments/${attachmentId}`;
  const response = await GET(
    new Request(`http://localhost${path}?preview=1`, { headers: { cookie: cookieFor(accountId) } }),
    { params: Promise.resolve({ accountId, messageId, attachmentId }) }
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  return { path, html: await response.text() };
}

describe("GET /api/accounts/[accountId]/messages/[messageId]/attachments/[attachmentId]?preview=1", () => {
  test("frames the attachment in a shell titled after the file", async () => {
    const attachmentId = "att-preview-image-0";
    const { accountId, messageId } = await seedAttachments([
      { id: attachmentId, filename: "qrcode.png", contentType: "image/png", size: 10, inline: false }
    ]);

    const { path, html } = await fetchPreviewShell(accountId, messageId, attachmentId);
    expect(html).toContain("<title>qrcode.png");
    expect(html).toContain(`<iframe src="${path}"></iframe>`);
  });

  test("puts a light backdrop behind text attachments and a dark one behind the rest", async () => {
    const { accountId, messageId } = await seedAttachments([
      { id: "att-preview-md-0", filename: "notes.md", contentType: "text/markdown; charset=utf-8", size: 10, inline: false },
      { id: "att-preview-txt-1", filename: "notes.txt", contentType: "text/plain", size: 10, inline: false },
      { id: "att-preview-pdf-2", filename: "report.pdf", contentType: "application/pdf", size: 10, inline: false }
    ]);

    const markdown = await fetchPreviewShell(accountId, messageId, "att-preview-md-0");
    expect(markdown.html).toContain("background:#fff");
    const text = await fetchPreviewShell(accountId, messageId, "att-preview-txt-1");
    expect(text.html).toContain("background:#fff");
    const pdf = await fetchPreviewShell(accountId, messageId, "att-preview-pdf-2");
    expect(pdf.html).toContain("background:#1f1d1a");
  });
});
