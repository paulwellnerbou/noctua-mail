import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { Account, Folder, Message } from "./data";
import {
  createTopic,
  exportTopicTransferData,
  getTopicsForThread,
  importTopicTransferData,
  listTopics,
  setThreadTopics
} from "./topics";

const previousDataDir = process.env.NOCTUA_DATA_DIR;
const previousIdleMs = process.env.ACCOUNT_DB_IDLE_MS;
const dataDir = mkdtempSync(path.join(tmpdir(), "mywebmail-topics-transfer-"));

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
  dateValue: number;
}): Message {
  return {
    id: params.id,
    accountId: params.accountId,
    folderId: params.folderId,
    threadId: params.threadId,
    messageId: params.messageId,
    subject: params.messageId,
    from: "alerts@example.com",
    to: "owner@example.com",
    preview: params.messageId,
    date: new Date(params.dateValue).toISOString(),
    dateValue: params.dateValue,
    body: params.messageId
  };
}

describe("topic transfer", () => {
  beforeAll(async () => {
    const { upsertAccount } = await dbModulePromise;
    await upsertAccount(buildAccount("acc-topics-transfer-bootstrap"));
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

  test("imports topic assignments onto the local thread resolved by exported message ids", async () => {
    const sourceAccountId = "acc-topics-source";
    const targetAccountId = "acc-topics-target";
    const sourceFolder = buildFolder(sourceAccountId);
    const targetFolder = buildFolder(targetAccountId);
    const exportedMessageId = "<topic-export@example.com>";
    const { saveFoldersForAccount, upsertAccount, upsertMessages } = await dbModulePromise;

    await upsertAccount(buildAccount(sourceAccountId));
    await upsertAccount(buildAccount(targetAccountId));
    await saveFoldersForAccount(sourceAccountId, [sourceFolder]);
    await saveFoldersForAccount(targetAccountId, [targetFolder]);

    await upsertMessages(
      sourceAccountId,
      sourceFolder.id,
      [
        buildMessage({
          id: "source-message",
          accountId: sourceAccountId,
          folderId: sourceFolder.id,
          threadId: "source-thread",
          messageId: exportedMessageId,
          dateValue: Date.UTC(2026, 2, 15, 9, 0, 0)
        })
      ],
      true,
      { recomputeThreads: false }
    );

    await upsertMessages(
      targetAccountId,
      targetFolder.id,
      [
        buildMessage({
          id: "target-message",
          accountId: targetAccountId,
          folderId: targetFolder.id,
          threadId: "target-thread",
          messageId: exportedMessageId,
          dateValue: Date.UTC(2026, 2, 15, 9, 5, 0)
        })
      ],
      true,
      { recomputeThreads: false }
    );

    const topic = await createTopic(sourceAccountId, "GitLab", "blue");
    await setThreadTopics(sourceAccountId, "source-thread", [topic.id]);

    const exported = await exportTopicTransferData(sourceAccountId);
    const summary = await importTopicTransferData(targetAccountId, exported);

    expect(summary.topicCount).toBe(1);
    expect(summary.assignmentCount).toBe(1);
    expect(summary.resolvedThreadCount).toBe(1);
    expect(summary.unresolvedThreadCount).toBe(0);

    const importedTopics = await getTopicsForThread(targetAccountId, "target-thread");
    expect(importedTopics.map((item) => item.name)).toEqual(["GitLab"]);
  });

  test("replaces existing topics data and preserves unresolved imported assignments", async () => {
    const accountId = "acc-topics-unresolved";
    const { upsertAccount } = await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await createTopic(accountId, "Old topic", "red");

    const summary = await importTopicTransferData(accountId, {
      version: 1,
      exportedAt: Date.UTC(2026, 2, 15, 10, 0, 0),
      topics: [
        {
          id: "topic-new",
          name: "Imported topic",
          color: "green",
          imapKeyword: "noctua-topic-topic-new",
          createdAt: Date.UTC(2026, 2, 15, 10, 0, 0),
          updatedAt: Date.UTC(2026, 2, 15, 10, 0, 0)
        }
      ],
      threads: [
        {
          threadId: "missing-thread",
          topicIds: ["topic-new"],
          messageIds: ["<missing-thread@example.com>"]
        }
      ]
    });

    expect(summary.topicCount).toBe(1);
    expect(summary.assignmentCount).toBe(1);
    expect(summary.resolvedThreadCount).toBe(0);
    expect(summary.unresolvedThreadCount).toBe(1);

    const topics = await listTopics(accountId);
    expect(topics.map((item) => item.name)).toEqual(["Imported topic"]);

    const unresolvedTopics = await getTopicsForThread(accountId, "missing-thread");
    expect(unresolvedTopics.map((item) => item.id)).toEqual(["topic-new"]);
  });
});
