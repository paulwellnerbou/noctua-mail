import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { Account, Folder, Message } from "./data";

const previousDataDir = process.env.NOCTUA_DATA_DIR;
const previousIdleMs = process.env.ACCOUNT_DB_IDLE_MS;
const dataDir = mkdtempSync(path.join(tmpdir(), "mywebmail-calendar-invite-state-"));

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
  eventUid: string;
}): Message {
  return {
    id: params.id,
    accountId: params.accountId,
    folderId: params.folderId,
    threadId: params.threadId,
    subject: "Invite",
    from: "sender@example.com",
    to: "recipient@example.com",
    preview: "Invite",
    date: new Date(Date.UTC(2026, 2, 23, 11, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 2, 23, 11, 0, 0),
    body: "Invite body",
    calendarEventUids: [params.eventUid],
    calendarInviteStates: [
      {
        eventUid: params.eventUid,
        actionType: "update"
      }
    ]
  };
}

describe("calendar invite state persistence", () => {
  beforeAll(async () => {
    const { upsertAccount } = await dbModulePromise;
    await upsertAccount(buildAccount("acc-calendar-invite-state-bootstrap"));
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

  test("listThreadMessages returns processed invite state from storage", async () => {
    const accountId = "acc-calendar-invite-state";
    const folder = buildFolder(accountId);
    const eventUid = "event-series@example.com";
    const {
      upsertAccount,
      saveFoldersForAccount,
      upsertMessages,
      upsertMessageCalendarInviteStates,
      markMessageCalendarInviteStatesProcessed,
      listThreadMessages
    } = await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);
    await upsertMessages(
      accountId,
      folder.id,
      [
        buildMessage({
          id: "invite-message-1",
          accountId,
          folderId: folder.id,
          threadId: "thread-1",
          eventUid
        })
      ],
      true
    );
    await upsertMessageCalendarInviteStates(accountId, "invite-message-1", [
      {
        eventUid,
        actionType: "update"
      }
    ]);
    await markMessageCalendarInviteStatesProcessed(
      accountId,
      "invite-message-1",
      [eventUid],
      {
        processedAtMs: 4242,
        processedAutomatically: false,
        processedByUserId: "user-1"
      }
    );

    const result = await listThreadMessages({
      accountId,
      threadIds: ["thread-1"]
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.calendarEventUids).toEqual([eventUid]);
    expect(result.items[0]?.calendarInviteStates).toEqual([
      {
        eventUid,
        actionType: "update",
        processedAtMs: 4242,
        processedAutomatically: false,
        processedByUserId: "user-1"
      }
    ]);
  });
});
