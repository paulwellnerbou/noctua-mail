import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account, Attachment, Folder, Message } from "@/lib/data";
import { sealSession, type SessionData } from "@/lib/auth";
import { dbModulePromise } from "@/lib/testDbHarness";
import {
  ATTACHMENT_EML,
  ATTACHMENT_EML_INVOICE_TEXT,
  BINARY_ATTACHMENT_EML,
  BINARY_ATTACHMENT_EML_BYTES
} from "@/lib/testEmlFixtures";

const { saveFoldersForAccount, upsertAccount, upsertMessages } = await dbModulePromise;
const { GET } = await import("./route");
const { getAttachmentData, saveAttachmentData, saveMessageSource } = await import("@/lib/storage");

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

async function fetchAttachment(accountId: string, messageId: string, attachmentId: string, query = "") {
  const path = `/api/accounts/${accountId}/messages/${messageId}/attachments/${attachmentId}`;
  return GET(
    new Request(`http://localhost${path}${query}`, { headers: { cookie: cookieFor(accountId) } }),
    { params: Promise.resolve({ accountId, messageId, attachmentId }) }
  );
}

describe("GET /api/accounts/[accountId]/messages/[messageId]/attachments/[attachmentId]", () => {
  test("serves stored bytes with the attachment's content type and filename", async () => {
    const attachmentId = "att-data-stored-0";
    const { accountId, messageId } = await seedAttachments([
      { id: attachmentId, filename: "report.pdf", contentType: "application/pdf", size: 6, inline: false }
    ]);
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    await saveAttachmentData(accountId, messageId, attachmentId, bytes);

    const inline = await fetchAttachment(accountId, messageId, attachmentId);
    expect(inline.status).toBe(200);
    expect(inline.headers.get("Content-Type")).toBe("application/pdf");
    expect(inline.headers.get("Content-Disposition")).toBe(
      "inline; filename=\"report.pdf\"; filename*=UTF-8''report.pdf"
    );
    expect(Buffer.from(await inline.arrayBuffer()).equals(bytes)).toBe(true);

    const download = await fetchAttachment(accountId, messageId, attachmentId, "?download=1");
    expect(download.headers.get("Content-Disposition")).toStartWith("attachment;");
  });

  test("extracts the bytes from the cached raw source when no stored copy exists", async () => {
    const attachmentId = "att-data-source-0";
    const { accountId, messageId } = await seedAttachments([
      { id: attachmentId, filename: "invoice.pdf", contentType: "application/pdf", size: 10, inline: false }
    ]);
    await saveMessageSource(accountId, messageId, ATTACHMENT_EML);

    const response = await fetchAttachment(accountId, messageId, attachmentId);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(ATTACHMENT_EML_INVOICE_TEXT);
    expect((await getAttachmentData(accountId, messageId, attachmentId))?.toString("utf8")).toBe(
      ATTACHMENT_EML_INVOICE_TEXT
    );
  });

  test("keeps the bytes of a binary-encoded part intact when extracting from the source", async () => {
    const attachmentId = "att-data-binary-0";
    const { accountId, messageId } = await seedAttachments([
      {
        id: attachmentId,
        filename: "blob.bin",
        contentType: "application/octet-stream",
        size: BINARY_ATTACHMENT_EML_BYTES.length,
        inline: false
      }
    ]);
    await saveMessageSource(accountId, messageId, BINARY_ATTACHMENT_EML);

    const response = await fetchAttachment(accountId, messageId, attachmentId);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(BINARY_ATTACHMENT_EML_BYTES)).toBe(true);
  });

  test("answers 404 when neither stored bytes nor a source exist", async () => {
    const { accountId, messageId } = await seedAttachments([
      { id: "att-data-none-0", filename: "missing.pdf", contentType: "application/pdf", size: 1, inline: false }
    ]);

    const noData = await fetchAttachment(accountId, messageId, "att-data-none-0");
    expect(noData.status).toBe(404);
    expect(await noData.json()).toEqual({ ok: false, message: "Attachment data not found" });

    const unknown = await fetchAttachment(accountId, messageId, "att-data-unknown-9");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ ok: false, message: "Attachment not found" });
  });
});

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
