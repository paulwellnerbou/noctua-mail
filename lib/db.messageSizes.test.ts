import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account, Folder, Message } from "./data";
import { buildImapMessageRowId } from "./messageIds";
import { saveMessageSource } from "./storage";
import { dbModulePromise } from "./testDbHarness";
import { backfillMessageSourceSizes, ensureMessageSourceSizes } from "./db/messages/sizes";

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Message sizes",
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
  imapUid: number;
  messageId: string;
  subject: string;
  dateValue: number;
  sizeBytes?: number;
  hasSource?: boolean;
  flagged?: boolean;
}): Message {
  return {
    id: buildImapMessageRowId(params.messageId),
    accountId: params.accountId,
    folderId: params.folderId,
    mailboxPath: "INBOX",
    imapUid: params.imapUid,
    threadId: params.messageId,
    messageId: params.messageId,
    subject: params.subject,
    from: "sender@example.test",
    to: "owner@example.test",
    preview: "Preview",
    date: new Date(params.dateValue).toISOString(),
    dateValue: params.dateValue,
    body: "Body",
    sizeBytes: params.sizeBytes,
    hasSource: params.hasSource,
    flagged: params.flagged,
    unread: true,
    seen: false
  };
}

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

const BASE_DATE = Date.UTC(2026, 3, 12, 10, 0, 0);

async function seedAccount(accountId: string, messages: Message[]) {
  const inbox = buildFolder(accountId, "INBOX");
  const { saveFoldersForAccount, upsertAccount, upsertMessages } = await dbModulePromise;
  await upsertAccount(buildAccount(accountId));
  await saveFoldersForAccount(accountId, [inbox]);
  await upsertMessages(accountId, inbox.id, messages, true);
  return inbox;
}

describe("listMessages sortBy: size", () => {
  test("orders by stored source size, largest first", async () => {
    const accountId = uniqueAccountId("acc-size-order");
    // Dates run counter to the sizes so a date fallback would be visible.
    const inbox = await seedAccount(accountId, [
      buildMessage({
        accountId,
        folderId: `${accountId}:INBOX`,
        imapUid: 1,
        messageId: "<small@example.test>",
        subject: "Small",
        dateValue: BASE_DATE + 3000,
        sizeBytes: 2_048
      }),
      buildMessage({
        accountId,
        folderId: `${accountId}:INBOX`,
        imapUid: 2,
        messageId: "<huge@example.test>",
        subject: "Huge",
        dateValue: BASE_DATE + 1000,
        sizeBytes: 9_000_000
      }),
      buildMessage({
        accountId,
        folderId: `${accountId}:INBOX`,
        imapUid: 3,
        messageId: "<medium@example.test>",
        subject: "Medium",
        dateValue: BASE_DATE + 2000,
        sizeBytes: 512_000
      })
    ]);

    const { listMessages } = await dbModulePromise;
    const result = await listMessages({
      accountId,
      folderId: inbox.id,
      page: 1,
      pageSize: 50,
      sortBy: "size"
    });

    expect(result.items.map((item) => item.subject)).toEqual(["Huge", "Medium", "Small"]);
    expect(result.items.map((item) => item.sizeBytes)).toEqual([9_000_000, 512_000, 2_048]);
  });

  test("messages with no recorded size sort last", async () => {
    const accountId = uniqueAccountId("acc-size-nulls");
    const inbox = await seedAccount(accountId, [
      buildMessage({
        accountId,
        folderId: `${accountId}:INBOX`,
        imapUid: 1,
        messageId: "<unknown@example.test>",
        subject: "Unknown",
        // Newest, so a date ordering would put it first.
        dateValue: BASE_DATE + 9000
      }),
      buildMessage({
        accountId,
        folderId: `${accountId}:INBOX`,
        imapUid: 2,
        messageId: "<tiny@example.test>",
        subject: "Tiny",
        dateValue: BASE_DATE,
        sizeBytes: 12
      })
    ]);

    const { listMessages } = await dbModulePromise;
    const result = await listMessages({
      accountId,
      folderId: inbox.id,
      page: 1,
      pageSize: 50,
      sortBy: "size"
    });

    expect(result.items.map((item) => item.subject)).toEqual(["Tiny", "Unknown"]);
    expect(result.items[1]?.sizeBytes).toBeUndefined();
  });

  test("flagged messages are not floated to the top of a size ordering", async () => {
    const accountId = uniqueAccountId("acc-size-flagged");
    const inbox = await seedAccount(accountId, [
      buildMessage({
        accountId,
        folderId: `${accountId}:INBOX`,
        imapUid: 1,
        messageId: "<flagged-small@example.test>",
        subject: "Flagged small",
        dateValue: BASE_DATE,
        sizeBytes: 100,
        flagged: true
      }),
      buildMessage({
        accountId,
        folderId: `${accountId}:INBOX`,
        imapUid: 2,
        messageId: "<plain-big@example.test>",
        subject: "Plain big",
        dateValue: BASE_DATE,
        sizeBytes: 5_000_000
      })
    ]);

    const { listMessages } = await dbModulePromise;
    const sizeOrdered = await listMessages({
      accountId,
      folderId: inbox.id,
      page: 1,
      pageSize: 50,
      sortBy: "size"
    });
    expect(sizeOrdered.items.map((item) => item.subject)).toEqual(["Plain big", "Flagged small"]);

    const dateOrdered = await listMessages({
      accountId,
      folderId: inbox.id,
      page: 1,
      pageSize: 50
    });
    expect(dateOrdered.items[0]?.subject).toBe("Flagged small");
  });
});

describe("message size persistence", () => {
  test("a source-less re-upsert keeps the recorded size", async () => {
    const accountId = uniqueAccountId("acc-size-preserve");
    const messageId = "<preserve@example.test>";
    const inbox = await seedAccount(accountId, [
      buildMessage({
        accountId,
        folderId: `${accountId}:INBOX`,
        imapUid: 7,
        messageId,
        subject: "With size",
        dateValue: BASE_DATE,
        sizeBytes: 4_321
      })
    ]);

    const { listMessages, upsertMessages } = await dbModulePromise;
    // The envelope-only sync fallback re-upserts without a source.
    await upsertMessages(
      accountId,
      inbox.id,
      [
        buildMessage({
          accountId,
          folderId: inbox.id,
          imapUid: 7,
          messageId,
          subject: "Re-synced without source",
          dateValue: BASE_DATE
        })
      ],
      false
    );

    const result = await listMessages({
      accountId,
      folderId: inbox.id,
      page: 1,
      pageSize: 50
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.subject).toBe("Re-synced without source");
    expect(result.items[0]?.sizeBytes).toBe(4_321);
  });
});

describe("backfillMessageSourceSizes", () => {
  test("fills sizes from the stored .eml and leaves missing sources NULL", async () => {
    const accountId = uniqueAccountId("acc-size-backfill");
    const withFile = buildMessage({
      accountId,
      folderId: `${accountId}:INBOX`,
      imapUid: 1,
      messageId: "<on-disk@example.test>",
      subject: "On disk",
      dateValue: BASE_DATE,
      hasSource: true
    });
    const withoutFile = buildMessage({
      accountId,
      folderId: `${accountId}:INBOX`,
      imapUid: 2,
      messageId: "<gone@example.test>",
      subject: "Gone",
      dateValue: BASE_DATE,
      hasSource: true
    });
    const inbox = await seedAccount(accountId, [withFile, withoutFile]);

    const source = "Subject: On disk\r\n\r\nbody bytes";
    await saveMessageSource(accountId, withFile.id, source);

    const first = await backfillMessageSourceSizes(accountId);
    expect(first).toEqual({ filled: 1, missing: 1 });

    const { listMessages } = await dbModulePromise;
    const result = await listMessages({
      accountId,
      folderId: inbox.id,
      page: 1,
      pageSize: 50,
      sortBy: "size"
    });
    expect(result.items.map((item) => item.subject)).toEqual(["On disk", "Gone"]);
    expect(result.items[0]?.sizeBytes).toBe(Buffer.byteLength(source));

    // The already-filled row is not revisited; only the missing one remains.
    const second = await backfillMessageSourceSizes(accountId);
    expect(second).toEqual({ filled: 0, missing: 1 });
  });

  test("ensureMessageSourceSizes runs one pass per account", async () => {
    const accountId = uniqueAccountId("acc-size-ensure");
    await seedAccount(accountId, [
      buildMessage({
        accountId,
        folderId: `${accountId}:INBOX`,
        imapUid: 1,
        messageId: "<ensure@example.test>",
        subject: "Ensure",
        dateValue: BASE_DATE,
        hasSource: true
      })
    ]);
    await saveMessageSource(accountId, buildImapMessageRowId("<ensure@example.test>"), "bytes");

    const first = ensureMessageSourceSizes(accountId);
    expect(ensureMessageSourceSizes(accountId)).toBe(first);
    expect(await first).toEqual({ filled: 1, missing: 0 });
    // A row with a missing source would otherwise be re-walked on every
    // size-ordered request; the cached pass is what stops that.
    expect(ensureMessageSourceSizes(accountId)).toBe(first);
  });
});
