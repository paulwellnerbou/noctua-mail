import { beforeAll, describe, expect, test } from "bun:test";
import type { Account, Folder, Message } from "./data";
import { dbModulePromise } from "./testDbHarness";

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

  test("listThreadMessages returns processed invite state from storage", async () => {
    const accountId = "acc-calendar-invite-state";
    const folder = buildFolder(accountId);
    const eventUid = "event-series@example.com";
    const {
      upsertAccount,
      saveFoldersForAccount,
      upsertMessages,
      listThreadMessages,
      withAccountDb
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
    await withAccountDb(accountId, (db) => {
      db.prepare(
        `INSERT OR REPLACE INTO message_calendar_events (
           accountId,
           messageId,
           eventUid,
           eventUidKey,
           inviteActionType,
           processedAtMs,
           processedByUserId,
           processedAutomatically
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        accountId,
        "invite-message-1",
        eventUid,
        eventUid.toLowerCase(),
        "update",
        4242,
        "user-1",
        0
      );
    });

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
