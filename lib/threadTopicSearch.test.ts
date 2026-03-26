import { beforeAll, describe, expect, test } from "bun:test";
import type { Account, Folder, Message } from "./data";
import { dbModulePromise } from "./testDbHarness";
import { createTopic, setThreadTopics } from "./topics";

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

function buildFolder(
  accountId: string,
  params: { suffix: string; name: string; specialUse: string }
): Folder {
  return {
    id: `${accountId}-${params.suffix}`,
    accountId,
    name: params.name,
    count: 0,
    unreadCount: 0,
    specialUse: params.specialUse
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
  subject: string;
  from: string;
  to: string;
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
    subject: params.subject,
    from: params.from,
    to: params.to,
    preview: params.subject,
    date: new Date(params.dateValue).toISOString(),
    dateValue: params.dateValue,
    body: params.subject
  };
}

describe("thread topic search", () => {
  beforeAll(async () => {
    const { upsertAccount } = await dbModulePromise;
    await upsertAccount(buildAccount("acc-thread-topic-search-bootstrap"));
  });

  test("topic search keeps the full thread when the matched thread includes excluded-folder messages", async () => {
    const accountId = "acc-thread-topic-search";
    const threadId = "<thread-topic-search@example.com>";
    const sentFolder = buildFolder(accountId, {
      suffix: "sent",
      name: "Sent",
      specialUse: "\\Sent"
    });
    const inboxFolder = buildFolder(accountId, {
      suffix: "inbox",
      name: "Inbox",
      specialUse: "\\Inbox"
    });
    const { listThreads, saveFoldersForAccount, upsertAccount, upsertMessages } =
      await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [inboxFolder, sentFolder]);

    await upsertMessages(
      accountId,
      sentFolder.id,
      [
        buildMessage({
          id: "sent-root",
          accountId,
          folderId: sentFolder.id,
          threadId,
          messageId: threadId,
          subject: "Project topic thread",
          from: "Owner <owner@example.com>",
          to: "Teammate <teammate@example.com>",
          dateValue: Date.UTC(2026, 2, 25, 9, 0, 0)
        })
      ],
      true
    );

    await upsertMessages(
      accountId,
      inboxFolder.id,
      [
        buildMessage({
          id: "inbox-reply",
          accountId,
          folderId: inboxFolder.id,
          threadId,
          messageId: "<reply-thread-topic-search@example.com>",
          inReplyTo: threadId,
          references: [threadId],
          subject: "Re: Project topic thread",
          from: "Teammate <teammate@example.com>",
          to: "Owner <owner@example.com>",
          dateValue: Date.UTC(2026, 2, 25, 10, 0, 0)
        })
      ],
      true
    );

    const topic = await createTopic(accountId, "Project Topic", "mint");
    await setThreadTopics(accountId, threadId, [topic.id]);

    const result = await listThreads({
      accountId,
      page: 1,
      pageSize: 50,
      query: `topic:${topic.id}`,
      excludedFolderIds: [sentFolder.id]
    });

    expect(result.items.map((item) => item.id).sort()).toEqual(["inbox-reply", "sent-root"]);
    expect(result.total).toBe(1);
    expect(result.baseCount).toBe(1);
  });
});
