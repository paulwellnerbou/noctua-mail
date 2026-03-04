import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { Account, Folder, Message } from "./data";

const previousDataDir = process.env.NOCTUA_DATA_DIR;
const previousIdleMs = process.env.ACCOUNT_DB_IDLE_MS;
const dataDir = mkdtempSync(path.join(tmpdir(), "mywebmail-calendar-search-"));

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
  from: string;
  to: string;
  subject: string;
  dateValue: number;
  calendarEventUid: string;
}): Message {
  return {
    id: params.id,
    accountId: params.accountId,
    folderId: params.folderId,
    threadId: params.threadId,
    subject: params.subject,
    from: params.from,
    to: params.to,
    preview: params.subject,
    date: new Date(params.dateValue).toISOString(),
    dateValue: params.dateValue,
    body: params.subject,
    calendarEventUids: [params.calendarEventUid]
  };
}

describe("calendar invite search", () => {
  beforeAll(async () => {
    const { upsertAccount } = await dbModulePromise;
    await upsertAccount(buildAccount("acc-calendar-search-bootstrap"));
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

  test("invite: matches recurring Google invite variants by base UID", async () => {
    const accountId = "acc-calendar-search-invite";
    const folder = buildFolder(accountId);
    const { upsertAccount, saveFoldersForAccount, upsertMessages, listMessages } =
      await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);
    await upsertMessages(
      accountId,
      folder.id,
      [
        buildMessage({
          id: "invite-base",
          accountId,
          folderId: folder.id,
          threadId: "thread-a",
          from: "alice-one@example.com",
          to: "bob-one@example.com",
          subject: "Base invite",
          dateValue: Date.UTC(2026, 2, 4, 10, 0, 0),
          calendarEventUid: "series@example.com"
        }),
        buildMessage({
          id: "invite-recurrence",
          accountId,
          folderId: folder.id,
          threadId: "thread-b",
          from: "carol-two@example.com",
          to: "dave-two@example.com",
          subject: "Recurring invite instance",
          dateValue: Date.UTC(2026, 2, 5, 10, 0, 0),
          calendarEventUid: "series_r20260311t100000z@example.com"
        })
      ],
      true
    );

    const result = await listMessages({
      accountId,
      folderId: folder.id,
      page: 1,
      pageSize: 20,
      query: "invite:series@example.com"
    });

    expect(result.items.map((item) => item.id).sort()).toEqual([
      "invite-base",
      "invite-recurrence"
    ]);
  });

  test("related: includes invite mails with the same base UID", async () => {
    const accountId = "acc-calendar-search-related";
    const folder = buildFolder(accountId);
    const { upsertAccount, saveFoldersForAccount, upsertMessages, listRelatedMessages } =
      await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);
    await upsertMessages(
      accountId,
      folder.id,
      [
        buildMessage({
          id: "related-target",
          accountId,
          folderId: folder.id,
          threadId: "thread-c",
          from: "eve-one@example.com",
          to: "frank-one@example.com",
          subject: "Planning sync",
          dateValue: Date.UTC(2026, 2, 6, 9, 0, 0),
          calendarEventUid: "series_r20260318t090000z@example.com"
        }),
        buildMessage({
          id: "related-base",
          accountId,
          folderId: folder.id,
          threadId: "thread-d",
          from: "grace-two@example.com",
          to: "heidi-two@example.com",
          subject: "Unrelated subject",
          dateValue: Date.UTC(2026, 2, 7, 9, 0, 0),
          calendarEventUid: "series@example.com"
        })
      ],
      true
    );

    const result = await listRelatedMessages({
      accountId,
      relatedId: "related-target",
      page: 1,
      pageSize: 20
    });

    expect(result.items.map((item) => item.id)).toContain("related-base");
  });
});
