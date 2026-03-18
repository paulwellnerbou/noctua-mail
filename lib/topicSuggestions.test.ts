import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { Account, Folder, Message } from "./data";
import { createTopic, getTopicStats, getTopicSuggestionsForMessage, getTopicSuggestionsForThread, getTopicsForThread, setThreadTopics } from "./topics";

const previousDataDir = process.env.NOCTUA_DATA_DIR;
const previousIdleMs = process.env.ACCOUNT_DB_IDLE_MS;
const dataDir = mkdtempSync(path.join(tmpdir(), "mywebmail-topic-suggestions-"));

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
  subject?: string;
  from: string;
  fromEmail: string;
  to: string;
  cc?: string;
  listId?: string;
  dateValue: number;
}): Message {
  return {
    id: params.id,
    accountId: params.accountId,
    folderId: params.folderId,
    threadId: params.threadId,
    messageId: params.messageId,
    subject: params.subject ?? params.messageId,
    from: params.from,
    fromEmail: params.fromEmail,
    to: params.to,
    cc: params.cc,
    listId: params.listId,
    preview: params.messageId,
    date: new Date(params.dateValue).toISOString(),
    dateValue: params.dateValue,
    body: params.messageId
  };
}

describe("topic suggestions", () => {
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

  test("prefers a strong multi-signal match over a more common weak match", async () => {
    const accountId = "acc-topic-suggestions";
    const folder = buildFolder(accountId);
    const { saveFoldersForAccount, upsertAccount, upsertMessages } = await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);

    await upsertMessages(
      accountId,
      folder.id,
      [
        buildMessage({
          id: "msg-strong",
          accountId,
          folderId: folder.id,
          threadId: "thread-strong",
          messageId: "<strong@example.com>",
          from: "Alerts <alerts@example.com>",
          fromEmail: "alerts@example.com",
          to: "Platform Team <team@example.com>",
          listId: "lists.example.com/unified-api",
          dateValue: Date.UTC(2026, 2, 18, 8, 0, 0)
        }),
        buildMessage({
          id: "msg-weak-1",
          accountId,
          folderId: folder.id,
          threadId: "thread-weak-1",
          messageId: "<weak-1@example.com>",
          from: "Build Bot <bot1@example.com>",
          fromEmail: "bot1@example.com",
          to: "Someone Else <other@example.com>",
          dateValue: Date.UTC(2026, 2, 18, 8, 5, 0)
        }),
        buildMessage({
          id: "msg-weak-2",
          accountId,
          folderId: folder.id,
          threadId: "thread-weak-2",
          messageId: "<weak-2@example.com>",
          from: "Build Bot <bot2@example.com>",
          fromEmail: "bot2@example.com",
          to: "Someone Else <other@example.com>",
          dateValue: Date.UTC(2026, 2, 18, 8, 10, 0)
        }),
        buildMessage({
          id: "msg-weak-3",
          accountId,
          folderId: folder.id,
          threadId: "thread-weak-3",
          messageId: "<weak-3@example.com>",
          from: "Build Bot <bot3@example.com>",
          fromEmail: "bot3@example.com",
          to: "Someone Else <other@example.com>",
          dateValue: Date.UTC(2026, 2, 18, 8, 15, 0)
        })
      ],
      true,
      { recomputeThreads: false }
    );

    const strongTopic = await createTopic(accountId, "Unified-API", "violet");
    const weakTopic = await createTopic(accountId, "PlanR", "red");
    await setThreadTopics(accountId, "thread-strong", [strongTopic.id]);
    await setThreadTopics(accountId, "thread-weak-1", [weakTopic.id]);
    await setThreadTopics(accountId, "thread-weak-2", [weakTopic.id]);
    await setThreadTopics(accountId, "thread-weak-3", [weakTopic.id]);

    const suggestions = await getTopicSuggestionsForMessage(accountId, {
      fromEmail: "alerts@example.com",
      to: "Platform Team <team@example.com>",
      listId: "lists.example.com/unified-api"
    });

    expect(suggestions.map((topic) => topic.name)).toEqual(["Unified-API", "PlanR"]);
    expect(suggestions[0]?.suggestionScore).toBe(11);
    expect(suggestions[0]?.matchCount).toBe(1);
    expect(suggestions[1]?.suggestionScore).toBe(3);
    expect(suggestions[1]?.matchCount).toBe(3);
  });

  test("ignores the account owner's own email as a recipient suggestion signal", async () => {
    const accountId = "acc-topic-suggestions-own-recipient";
    const folder = buildFolder(accountId);
    const { saveFoldersForAccount, upsertAccount, upsertMessages } = await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);

    await upsertMessages(
      accountId,
      folder.id,
      [
        buildMessage({
          id: "msg-history-1",
          accountId,
          folderId: folder.id,
          threadId: "thread-history-1",
          messageId: "<history-1@example.com>",
          from: "Bot 1 <bot1@example.com>",
          fromEmail: "bot1@example.com",
          to: "owner@example.com",
          dateValue: Date.UTC(2026, 2, 18, 9, 0, 0)
        }),
        buildMessage({
          id: "msg-history-2",
          accountId,
          folderId: folder.id,
          threadId: "thread-history-2",
          messageId: "<history-2@example.com>",
          from: "Bot 2 <bot2@example.com>",
          fromEmail: "bot2@example.com",
          to: "owner@example.com",
          dateValue: Date.UTC(2026, 2, 18, 9, 5, 0)
        })
      ],
      true,
      { recomputeThreads: false }
    );

    const topic = await createTopic(accountId, "Unified-API", "violet");
    await setThreadTopics(accountId, "thread-history-1", [topic.id]);
    await setThreadTopics(accountId, "thread-history-2", [topic.id]);

    const suggestions = await getTopicSuggestionsForMessage(accountId, {
      fromEmail: "newsletter@kajabi.example",
      to: "owner@example.com"
    }, {
      accountEmail: "owner@example.com"
    });

    expect(suggestions).toEqual([]);
  });

  test("uses Jira project keys to distinguish topics with otherwise identical sender signals", async () => {
    const accountId = "acc-topic-suggestions-jira-message";
    const folder = buildFolder(accountId);
    const { saveFoldersForAccount, upsertAccount, upsertMessages } = await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);

    await upsertMessages(
      accountId,
      folder.id,
      [
        buildMessage({
          id: "msg-unsapix",
          accountId,
          folderId: folder.id,
          threadId: "thread-unsapix",
          messageId: "<JIRA.100.1773827800000@Atlassian.JIRA>",
          subject: "[subshell Support] (UNSAPIX-24) Bug report",
          from: "Support System <noreply@subshell.com>",
          fromEmail: "noreply@subshell.com",
          to: "paul@example.com",
          dateValue: Date.UTC(2026, 2, 18, 9, 10, 0)
        }),
        buildMessage({
          id: "msg-planr",
          accountId,
          folderId: folder.id,
          threadId: "thread-planr",
          messageId: "<JIRA.101.1773827810000@Atlassian.JIRA>",
          subject: "[subshell Support] (PLANR-88) Feature request",
          from: "Support System <noreply@subshell.com>",
          fromEmail: "noreply@subshell.com",
          to: "paul@example.com",
          dateValue: Date.UTC(2026, 2, 18, 9, 20, 0)
        })
      ],
      true,
      { recomputeThreads: false }
    );

    const unsapixTopic = await createTopic(accountId, "UNSAPIX", "blue");
    const planrTopic = await createTopic(accountId, "PLANR", "red");
    await setThreadTopics(accountId, "thread-unsapix", [unsapixTopic.id]);
    await setThreadTopics(accountId, "thread-planr", [planrTopic.id]);

    const suggestions = await getTopicSuggestionsForMessage(accountId, {
      fromEmail: "noreply@subshell.com",
      to: "paul@example.com",
      subject: "[subshell Support] (UNSAPIX-311) Buegeleisen: TopMedia",
      messageId: "<JIRA.132074.1770738900000.60180.1773827820586@Atlassian.JIRA>"
    });

    expect(suggestions.map((topic) => topic.name)).toEqual(["UNSAPIX", "PLANR"]);
    expect(suggestions[0]?.suggestionScore).toBe(11);
    expect(suggestions[0]?.matchCount).toBe(1);
    expect(suggestions[1]?.suggestionScore).toBe(7);
    expect(suggestions[1]?.matchCount).toBe(1);
  });

  test("derives suggestion signals from stored thread messages", async () => {
    const accountId = "acc-topic-suggestions-thread-signals";
    const folder = buildFolder(accountId);
    const { saveFoldersForAccount, upsertAccount, upsertMessages } = await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);

    await upsertMessages(
      accountId,
      folder.id,
      [
        buildMessage({
          id: "msg-history",
          accountId,
          folderId: folder.id,
          threadId: "thread-history",
          messageId: "<history@example.com>",
          from: "GitLab <gitlab@mg.gitlab.com>",
          fromEmail: "gitlab@mg.gitlab.com",
          to: "owner@example.com",
          listId: "linon/erwin/planning <40384606.planning.erwin.linon.gitlab.com>",
          dateValue: Date.UTC(2026, 2, 18, 10, 0, 0)
        }),
        buildMessage({
          id: "msg-target",
          accountId,
          folderId: folder.id,
          threadId: "thread-target",
          messageId: "<target@example.com>",
          from: "GitLab <gitlab@mg.gitlab.com>",
          fromEmail: "gitlab@mg.gitlab.com",
          to: "owner@example.com",
          listId: "linon/erwin/planning <40384606.planning.erwin.linon.gitlab.com>",
          dateValue: Date.UTC(2026, 2, 18, 10, 5, 0)
        })
      ],
      true,
      { recomputeThreads: false }
    );

    const topic = await createTopic(accountId, "Linon", "orange");
    await setThreadTopics(accountId, "thread-history", [topic.id]);

    const suggestions = await getTopicSuggestionsForThread(accountId, "thread-target", {
      accountEmail: "owner@example.com"
    });

    expect(suggestions.map((item) => item.name)).toEqual(["Linon"]);
    expect(suggestions[0]?.suggestionScore).toBe(9);
    expect(suggestions[0]?.matchCount).toBe(1);
  });

  test("derives Jira project keys from stored thread messages", async () => {
    const accountId = "acc-topic-suggestions-thread-jira";
    const folder = buildFolder(accountId);
    const { saveFoldersForAccount, upsertAccount, upsertMessages } = await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);

    await upsertMessages(
      accountId,
      folder.id,
      [
        buildMessage({
          id: "msg-history-unsapix",
          accountId,
          folderId: folder.id,
          threadId: "thread-history-unsapix",
          messageId: "<JIRA.200.1773827820000@Atlassian.JIRA>",
          subject: "[subshell Support] (UNSAPIX-24) Bug report",
          from: "Support System <noreply@subshell.com>",
          fromEmail: "noreply@subshell.com",
          to: "paul@example.com",
          dateValue: Date.UTC(2026, 2, 18, 10, 0, 0)
        }),
        buildMessage({
          id: "msg-history-planr",
          accountId,
          folderId: folder.id,
          threadId: "thread-history-planr",
          messageId: "<JIRA.201.1773827830000@Atlassian.JIRA>",
          subject: "[subshell Support] (PLANR-88) Feature request",
          from: "Support System <noreply@subshell.com>",
          fromEmail: "noreply@subshell.com",
          to: "paul@example.com",
          dateValue: Date.UTC(2026, 2, 18, 10, 5, 0)
        }),
        buildMessage({
          id: "msg-target",
          accountId,
          folderId: folder.id,
          threadId: "thread-target",
          messageId: "<JIRA.202.1773827840000@Atlassian.JIRA>",
          subject: "[subshell Support] (UNSAPIX-311) Buegeleisen: TopMedia",
          from: "Support System <noreply@subshell.com>",
          fromEmail: "noreply@subshell.com",
          to: "paul@example.com",
          dateValue: Date.UTC(2026, 2, 18, 10, 10, 0)
        })
      ],
      true,
      { recomputeThreads: false }
    );

    const unsapixTopic = await createTopic(accountId, "UNSAPIX", "blue");
    const planrTopic = await createTopic(accountId, "PLANR", "red");
    await setThreadTopics(accountId, "thread-history-unsapix", [unsapixTopic.id]);
    await setThreadTopics(accountId, "thread-history-planr", [planrTopic.id]);

    const suggestions = await getTopicSuggestionsForThread(accountId, "thread-target", {
      accountEmail: "owner@example.com"
    });

    expect(suggestions.map((item) => item.name)).toEqual(["UNSAPIX", "PLANR"]);
    expect(suggestions[0]?.suggestionScore).toBe(11);
    expect(suggestions[0]?.matchCount).toBe(1);
    expect(suggestions[1]?.suggestionScore).toBe(7);
    expect(suggestions[1]?.matchCount).toBe(1);
  });

  test("refreshes persisted thread signals when new messages add learning signals to an existing topic thread", async () => {
    const accountId = "acc-topic-suggestions-late-signal";
    const folder = buildFolder(accountId);
    const { saveFoldersForAccount, upsertAccount, upsertMessages } = await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);

    await upsertMessages(
      accountId,
      folder.id,
      [
        buildMessage({
          id: "msg-history-initial",
          accountId,
          folderId: folder.id,
          threadId: "thread-history",
          messageId: "<history-initial@example.com>",
          from: "Alerts <alerts@example.com>",
          fromEmail: "alerts@example.com",
          to: "owner@example.com",
          dateValue: Date.UTC(2026, 2, 18, 10, 15, 0)
        })
      ],
      true,
      { recomputeThreads: false }
    );

    const topic = await createTopic(accountId, "Unified-API", "violet");
    await setThreadTopics(accountId, "thread-history", [topic.id]);

    await upsertMessages(
      accountId,
      folder.id,
      [
        buildMessage({
          id: "msg-history-late-signal",
          accountId,
          folderId: folder.id,
          threadId: "thread-history",
          messageId: "<history-late@example.com>",
          subject: "Late signal message",
          from: "Alerts <alerts@example.com>",
          fromEmail: "alerts@example.com",
          to: "owner@example.com",
          listId: "lists.example.com/unified-api",
          dateValue: Date.UTC(2026, 2, 18, 10, 20, 0)
        }),
        buildMessage({
          id: "msg-target-late-signal",
          accountId,
          folderId: folder.id,
          threadId: "thread-target",
          messageId: "<target-late@example.com>",
          subject: "Target message",
          from: "Other Alerts <noreply@example.com>",
          fromEmail: "noreply@example.com",
          to: "owner@example.com",
          listId: "lists.example.com/unified-api",
          dateValue: Date.UTC(2026, 2, 18, 10, 25, 0)
        })
      ],
      false,
      { recomputeThreads: false }
    );

    const suggestions = await getTopicSuggestionsForThread(accountId, "thread-target", {
      accountEmail: "owner@example.com"
    });

    expect(suggestions.map((item) => item.name)).toEqual(["Unified-API"]);
    expect(suggestions[0]?.suggestionScore).toBe(5);
    expect(suggestions[0]?.matchCount).toBe(1);
  });

  test("prunes orphaned thread-topic associations while retaining learned signals after the last message is deleted", async () => {
    const accountId = "acc-topic-orphan-prune";
    const folder = buildFolder(accountId);
    const { deleteMessageById, saveFoldersForAccount, upsertAccount, upsertMessages } = await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);

    await upsertMessages(
      accountId,
      folder.id,
      [
        buildMessage({
          id: "msg-history",
          accountId,
          folderId: folder.id,
          threadId: "thread-history",
          messageId: "<history-prune@example.com>",
          subject: "History message",
          from: "Alerts <alerts@example.com>",
          fromEmail: "alerts@example.com",
          to: "owner@example.com",
          dateValue: Date.UTC(2026, 2, 18, 10, 30, 0)
        })
      ],
      true,
      { recomputeThreads: false }
    );

    const topic = await createTopic(accountId, "Disposable", "red");
    await setThreadTopics(accountId, "thread-history", [topic.id]);

    await deleteMessageById(accountId, "msg-history");

    expect(await getTopicsForThread(accountId, "thread-history")).toEqual([]);
    const stats = await getTopicStats(accountId, {
      accountEmail: "owner@example.com"
    });
    expect(stats).toHaveLength(1);
    expect(stats[0]?.threadCount).toBe(1);
    expect(stats[0]?.messageCount).toBe(0);
    expect(stats[0]?.topSignals).toEqual(expect.arrayContaining([
      { type: "senderEmail", value: "alerts@example.com", count: 1 },
      { type: "senderDomain", value: "example.com", count: 1 }
    ]));

    const suggestions = await getTopicSuggestionsForMessage(accountId, {
      fromEmail: "alerts@example.com",
      to: "owner@example.com"
    }, {
      accountEmail: "owner@example.com"
    });
    expect(suggestions.map((item) => item.name)).toEqual(["Disposable"]);
  });

  test("reports all learned signal types in topic stats", async () => {
    const accountId = "acc-topic-stats-all-signals";
    const folder = buildFolder(accountId);
    const { saveFoldersForAccount, upsertAccount, upsertMessages } = await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);

    await upsertMessages(
      accountId,
      folder.id,
      [
        buildMessage({
          id: "msg-history-list",
          accountId,
          folderId: folder.id,
          threadId: "thread-history-list",
          messageId: "<history-list@example.com>",
          subject: "Unified API update",
          from: "Alerts <alerts@example.com>",
          fromEmail: "alerts@example.com",
          to: "Platform Team <team@example.com>",
          listId: "lists.example.com/unified-api",
          dateValue: Date.UTC(2026, 2, 18, 11, 0, 0)
        }),
        buildMessage({
          id: "msg-history-list-2",
          accountId,
          folderId: folder.id,
          threadId: "thread-history-list",
          messageId: "<history-list-2@example.com>",
          subject: "Re: Unified API update",
          from: "Alerts <alerts@example.com>",
          fromEmail: "alerts@example.com",
          to: "Platform Team <team@example.com>",
          listId: "lists.example.com/unified-api",
          dateValue: Date.UTC(2026, 2, 18, 11, 2, 0)
        }),
        buildMessage({
          id: "msg-history-jira",
          accountId,
          folderId: folder.id,
          threadId: "thread-history-jira",
          messageId: "<JIRA.300.1773827850000@Atlassian.JIRA>",
          subject: "[subshell Support] (UNSAPIX-24) Bug report",
          from: "Support System <noreply@subshell.com>",
          fromEmail: "noreply@subshell.com",
          to: "owner@example.com",
          dateValue: Date.UTC(2026, 2, 18, 11, 5, 0)
        })
      ],
      true,
      { recomputeThreads: false }
    );

    const topic = await createTopic(accountId, "Support", "blue");
    await setThreadTopics(accountId, "thread-history-list", [topic.id]);
    await setThreadTopics(accountId, "thread-history-jira", [topic.id]);

    const stats = await getTopicStats(accountId, {
      accountEmail: "owner@example.com"
    });

    expect(stats).toHaveLength(1);
    expect(stats[0]?.threadCount).toBe(2);
    expect(stats[0]?.messageCount).toBe(3);
    expect(stats[0]?.topSignals).toEqual(expect.arrayContaining([
      { type: "senderEmail", value: "alerts@example.com", count: 1 },
      { type: "senderEmail", value: "noreply@subshell.com", count: 1 },
      { type: "senderDomain", value: "example.com", count: 1 },
      { type: "senderDomain", value: "subshell.com", count: 1 },
      { type: "recipient", value: "team@example.com", count: 1 },
      { type: "listId", value: "lists.example.com/unified-api", count: 1 },
      { type: "jiraProjectKey", value: "UNSAPIX", count: 1 }
    ]));
    expect(stats[0]?.topSignals.some((signal) => signal.type === "recipient" && signal.value === "owner@example.com")).toBe(false);
  });
});
