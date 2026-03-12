import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { Account, Folder, Message } from "./data";

const previousDataDir = process.env.NOCTUA_DATA_DIR;
const previousIdleMs = process.env.ACCOUNT_DB_IDLE_MS;
const dataDir = mkdtempSync(path.join(tmpdir(), "mywebmail-thread-lookup-"));

process.env.NOCTUA_DATA_DIR = dataDir;
process.env.ACCOUNT_DB_IDLE_MS = "0";

const dbModulePromise = import("./db");

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Test Account",
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

function buildMessage(params: {
  id: string;
  accountId: string;
  folderId: string;
  threadId: string;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  dateValue: number;
}): Message {
  return {
    id: params.id,
    accountId: params.accountId,
    folderId: params.folderId,
    threadId: params.threadId,
    messageId: params.messageId,
    inReplyTo: params.inReplyTo,
    references: params.references,
    subject: params.messageId,
    from: "gitlab@example.com",
    to: "owner@example.com",
    preview: params.messageId,
    date: new Date(params.dateValue).toISOString(),
    dateValue: params.dateValue,
    body: params.messageId
  };
}

describe("thread header lookup", () => {
  beforeAll(async () => {
    const { upsertAccount } = await dbModulePromise;
    await upsertAccount(buildAccount("acc-thread-lookup-bootstrap"));
  });

  afterAll(async () => {
    const { closeAllDbConnections } = await dbModulePromise;
    closeAllDbConnections();
    if (previousDataDir === undefined) {
      delete process.env.NOCTUA_DATA_DIR;
    } else {
      process.env.NOCTUA_DATA_DIR = previousDataDir;
    }
    if (previousIdleMs === undefined) {
      delete process.env.ACCOUNT_DB_IDLE_MS;
    } else {
      process.env.ACCOUNT_DB_IDLE_MS = previousIdleMs;
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("maps both referenced message ids and referenced thread ids to the canonical thread", async () => {
    const accountId = "acc-thread-lookup";
    const mergeRequestId = "<merge_request_462663618@gitlab.com>";
    const noteId = "<note_3153489529@gitlab.com>";
    const folder = buildFolder(accountId);
    const { getThreadIdsByMessageIds, saveFoldersForAccount, upsertAccount, upsertMessages } =
      await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);
    await upsertMessages(
      accountId,
      folder.id,
      [
        buildMessage({
          id: "mr-update",
          accountId,
          folderId: folder.id,
          threadId: mergeRequestId,
          messageId: "<b3e49f0eec7a9e7bb4f2c4814093fef3@gitlab.com>",
          inReplyTo: mergeRequestId,
          references: ["<reply-3-epc133l0c6bgkjcj37xbfwgsz@gitlab.com>", mergeRequestId],
          dateValue: Date.UTC(2026, 2, 11, 14, 20, 13)
        }),
        buildMessage({
          id: "note-root",
          accountId,
          folderId: folder.id,
          threadId: mergeRequestId,
          messageId: noteId,
          inReplyTo: mergeRequestId,
          references: ["<reply-3-b0qecshn7yl48sqqmhc7c3dw0@gitlab.com>", mergeRequestId],
          dateValue: Date.UTC(2026, 2, 11, 14, 21, 12)
        })
      ],
      true
    );

    const mapping = await getThreadIdsByMessageIds(accountId, [mergeRequestId, noteId]);

    expect(mapping.get(mergeRequestId)).toBe(mergeRequestId);
    expect(mapping.get(noteId)).toBe(mergeRequestId);
  });
});
