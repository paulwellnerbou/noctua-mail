import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account, CalendarEvent, Folder, Message } from "./data";
import {
  EMPTY_CALENDAR_EVENT_EMAIL_SNAPSHOT,
  hasCalendarEventEmailSnapshot
} from "./calendarEventEmailSnapshot";
import { dbModulePromise } from "./testDbHarness";

const {
  getCalendarEventById,
  saveFoldersForAccount,
  upsertAccount,
  upsertCalendarEvent,
  upsertMessages
} = await dbModulePromise;

// Loading the .server module after the harness has primed NOCTUA_DATA_DIR so
// that its `getMessageById` reads from the test DB dir.
const { buildCalendarEventEmailSnapshotFromMessageId } = await import(
  "./calendarEventEmailSnapshot.server"
);

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Snapshot Test",
    email: "owner@example.test",
    avatar: "CS",
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

function buildFolder(accountId: string): Folder {
  return {
    id: `${accountId}:INBOX`,
    accountId,
    name: "INBOX",
    count: 0,
    unreadCount: 0,
    specialUse: "\\Inbox"
  };
}

function buildMessage(params: {
  accountId: string;
  folderId: string;
  id: string;
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  body?: string;
  htmlBody?: string;
  dateValue?: number;
}): Message {
  return {
    id: params.id,
    accountId: params.accountId,
    folderId: params.folderId,
    mailboxPath: "INBOX",
    threadId: `thread-${params.id}`,
    messageId: `<${params.id}@example.test>`,
    subject: params.subject ?? "Invite: Team sync",
    from: params.from ?? "alice@example.test",
    to: params.to ?? "owner@example.test",
    cc: params.cc,
    bcc: params.bcc,
    preview: "preview",
    date: new Date(params.dateValue ?? Date.UTC(2026, 3, 14, 10, 0, 0)).toISOString(),
    dateValue: params.dateValue ?? Date.UTC(2026, 3, 14, 10, 0, 0),
    body: params.body ?? "text body",
    htmlBody: params.htmlBody,
    flags: ["\\Seen"]
  };
}

function buildEvent(accountId: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const now = Date.UTC(2026, 3, 14, 12, 0, 0);
  return {
    id: `evt-${randomUUID()}`,
    accountId,
    eventUid: `uid-${randomUUID()}@example.test`,
    summary: "Team sync",
    startAtMs: now,
    endAtMs: now + 30 * 60 * 1000,
    allDay: false,
    sourceType: "email",
    createdAtMs: now,
    updatedAtMs: now,
    ...overrides
  };
}

describe("hasCalendarEventEmailSnapshot", () => {
  test("returns false for an empty snapshot", () => {
    expect(hasCalendarEventEmailSnapshot({})).toBe(false);
    expect(hasCalendarEventEmailSnapshot(EMPTY_CALENDAR_EVENT_EMAIL_SNAPSHOT)).toBe(false);
  });

  test("returns false when every column is whitespace", () => {
    expect(
      hasCalendarEventEmailSnapshot({
        sourceSubject: "",
        sourceFromAddr: "   ",
        sourceBodyText: "\t\n"
      })
    ).toBe(false);
  });

  test("returns true when subject is set", () => {
    expect(hasCalendarEventEmailSnapshot({ sourceSubject: "Hi" })).toBe(true);
  });

  test("returns true when only sourceDateMs is set", () => {
    expect(hasCalendarEventEmailSnapshot({ sourceDateMs: 0 })).toBe(true);
    expect(hasCalendarEventEmailSnapshot({ sourceDateMs: Date.UTC(2026, 0, 1) })).toBe(true);
  });

  test("returns true when only HTML body is set", () => {
    expect(hasCalendarEventEmailSnapshot({ sourceBodyHtml: "<p>hi</p>" })).toBe(true);
  });
});

describe("buildCalendarEventEmailSnapshotFromMessageId", () => {
  test("returns null for missing accountId", async () => {
    const snapshot = await buildCalendarEventEmailSnapshotFromMessageId("", "msg-1");
    expect(snapshot).toBeNull();
  });

  test("returns null for missing messageId", async () => {
    const snapshot = await buildCalendarEventEmailSnapshotFromMessageId("acc-1", "   ");
    expect(snapshot).toBeNull();
  });

  test("returns null when the message can't be found", async () => {
    const accountId = uniqueAccountId("acc-snap-missing");
    await upsertAccount(buildAccount(accountId));
    const snapshot = await buildCalendarEventEmailSnapshotFromMessageId(
      accountId,
      "row-does-not-exist"
    );
    expect(snapshot).toBeNull();
  });

  test("maps message fields onto the snapshot", async () => {
    const accountId = uniqueAccountId("acc-snap-ok");
    await upsertAccount(buildAccount(accountId));
    const folder = buildFolder(accountId);
    await saveFoldersForAccount(accountId, [folder]);
    const dateMs = Date.UTC(2026, 3, 14, 10, 30, 0);
    await upsertMessages(accountId, folder.id, [
      buildMessage({
        accountId,
        folderId: folder.id,
        id: "row-snap-1",
        subject: "Invite: Kickoff",
        from: "alice@example.test",
        to: "owner@example.test",
        cc: "bob@example.test",
        bcc: "carol@example.test",
        body: "plain body",
        htmlBody: "<p>html body</p>",
        dateValue: dateMs
      })
    ]);

    const snapshot = await buildCalendarEventEmailSnapshotFromMessageId(accountId, "row-snap-1");
    expect(snapshot).not.toBeNull();
    expect(snapshot?.sourceSubject).toBe("Invite: Kickoff");
    expect(snapshot?.sourceFromAddr).toBe("alice@example.test");
    expect(snapshot?.sourceToAddr).toBe("owner@example.test");
    expect(snapshot?.sourceCcAddr).toBe("bob@example.test");
    expect(snapshot?.sourceBccAddr).toBe("carol@example.test");
    expect(snapshot?.sourceDateMs).toBe(dateMs);
    expect(snapshot?.sourceBodyText).toBe("plain body");
    expect(snapshot?.sourceBodyHtml).toBe("<p>html body</p>");
  });

  test("leaves absent cc/bcc/html fields undefined", async () => {
    const accountId = uniqueAccountId("acc-snap-sparse");
    await upsertAccount(buildAccount(accountId));
    const folder = buildFolder(accountId);
    await saveFoldersForAccount(accountId, [folder]);
    await upsertMessages(accountId, folder.id, [
      buildMessage({
        accountId,
        folderId: folder.id,
        id: "row-snap-2"
      })
    ]);

    const snapshot = await buildCalendarEventEmailSnapshotFromMessageId(accountId, "row-snap-2");
    expect(snapshot).not.toBeNull();
    expect(snapshot?.sourceCcAddr).toBeUndefined();
    expect(snapshot?.sourceBccAddr).toBeUndefined();
    expect(snapshot?.sourceBodyHtml).toBeUndefined();
  });
});

describe("upsertCalendarEvent with snapshot columns", () => {
  test("round-trips all eight source-email fields", async () => {
    const accountId = uniqueAccountId("acc-cal-snap-roundtrip");
    await upsertAccount(buildAccount(accountId));
    const dateMs = Date.UTC(2026, 3, 14, 9, 15, 0);
    const event = buildEvent(accountId, {
      messageId: "msg-with-snapshot",
      sourceSubject: "Invite: Planning",
      sourceFromAddr: "alice@example.test",
      sourceToAddr: "owner@example.test",
      sourceCcAddr: "bob@example.test",
      sourceBccAddr: "carol@example.test",
      sourceDateMs: dateMs,
      sourceBodyText: "Let's sync",
      sourceBodyHtml: "<p>Let's sync</p>"
    });

    await upsertCalendarEvent(accountId, event);
    const fetched = await getCalendarEventById(accountId, event.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.sourceSubject).toBe("Invite: Planning");
    expect(fetched?.sourceFromAddr).toBe("alice@example.test");
    expect(fetched?.sourceToAddr).toBe("owner@example.test");
    expect(fetched?.sourceCcAddr).toBe("bob@example.test");
    expect(fetched?.sourceBccAddr).toBe("carol@example.test");
    expect(fetched?.sourceDateMs).toBe(dateMs);
    expect(fetched?.sourceBodyText).toBe("Let's sync");
    expect(fetched?.sourceBodyHtml).toBe("<p>Let's sync</p>");
  });

  test("leaves snapshot columns undefined on a non-email event", async () => {
    const accountId = uniqueAccountId("acc-cal-snap-local");
    await upsertAccount(buildAccount(accountId));
    const event = buildEvent(accountId, { sourceType: "local" });

    await upsertCalendarEvent(accountId, event);
    const fetched = await getCalendarEventById(accountId, event.id);
    expect(fetched?.sourceSubject).toBeUndefined();
    expect(fetched?.sourceFromAddr).toBeUndefined();
    expect(fetched?.sourceDateMs).toBeUndefined();
    expect(fetched?.sourceBodyHtml).toBeUndefined();
  });
});
