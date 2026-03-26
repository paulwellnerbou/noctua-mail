import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Account, CalendarEvent, Folder, Message } from "@/lib/data";
import { sealSession, type SessionData } from "@/lib/auth";
import { dbModulePromise } from "@/lib/testDbHarness";

type SentMail = {
  to?: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: Array<{
    filename: string;
    contentType: string;
    content: Buffer;
  }>;
};

let lastSentMail: SentMail | null = null;

const sendSmtpMessage = mock(async (_account: Account, mail: SentMail) => {
  lastSentMail = mail;
  return {
    messageId: "<sent-rsvp@example.test>",
    raw: Buffer.from("raw-rsvp", "utf8")
  };
});
const appendImapMessage = mock(async () => 7001);

const actualImap = await import("@/lib/mail/imap");
const actualSmtp = await import("@/lib/mail/smtp");

mock.module("@/lib/mail/imap", () => ({
  ...actualImap,
  appendImapMessage
}));

mock.module("@/lib/mail/smtp", () => ({
  ...actualSmtp,
  sendSmtpMessage
}));

afterAll(() => {
  mock.restore();
});

const { saveFoldersForAccount, upsertAccount, upsertCalendarEvent, upsertMessages } =
  await dbModulePromise;
const {
  handleCalendarEventRespondRequest,
  resolveCalendarReplySourceMessageRowId
} = await import("./route");

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Calendar RSVP Test",
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

function buildFolder(accountId: string, id: string, name: string, specialUse?: string): Folder {
  return {
    id,
    accountId,
    name,
    count: 0,
    unreadCount: 0,
    specialUse
  };
}

function buildMessage(params: {
  id: string;
  accountId: string;
  folderId: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  subject?: string;
  dateValue: number;
}): Message {
  return {
    id: params.id,
    accountId: params.accountId,
    folderId: params.folderId,
    threadId: params.references?.[0] ?? params.inReplyTo ?? params.messageId ?? params.id,
    messageId: params.messageId,
    inReplyTo: params.inReplyTo,
    references: params.references,
    subject: params.subject ?? "Invite",
    from: "Organizer <organizer@example.test>",
    to: "owner@example.test",
    preview: params.subject ?? "Invite",
    date: new Date(params.dateValue).toISOString(),
    dateValue: params.dateValue,
    body: "Invite body",
    mailboxPath: "INBOX",
    imapUid: Math.max(1, Math.floor(params.dateValue / 1000)),
    flags: []
  };
}

function buildEvent(params: {
  accountId: string;
  eventId: string;
  eventUid: string;
  messageId: string;
  occurrenceMessageIds?: Record<string, string>;
  recurrenceRule?: string;
  startAtMs?: number;
}): CalendarEvent {
  const startAtMs = params.startAtMs ?? Date.UTC(2026, 5, 1, 10, 0, 0);
  return {
    id: params.eventId,
    accountId: params.accountId,
    eventUid: params.eventUid,
    summary: "Planning Sync",
    startAtMs,
    allDay: false,
    recurrenceRule: params.recurrenceRule,
    sourceType: "email",
    messageId: params.messageId,
    occurrenceMessageIds: params.occurrenceMessageIds,
    rawIcs: [
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      `UID:${params.eventUid}`,
      "SUMMARY:Planning Sync",
      `DTSTART:${new Date(startAtMs).toISOString().replace(/[-:]/g, "").replace(".000", "").replace(".001", "")}`,
      "ORGANIZER;CN=Organizer:mailto:organizer@example.test",
      "ATTENDEE;CN=Owner;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:owner@example.test",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n"),
    myAttendeeEmail: "owner@example.test",
    createdAtMs: startAtMs - 1_000,
    updatedAtMs: startAtMs - 1_000
  };
}

function buildCookieHeader(accountId: string) {
  const session: SessionData = {
    userId: "user-calendar-rsvp",
    accountId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60
  };
  return `noctua_session=${encodeURIComponent(sealSession(session))}`;
}

function buildRequest(accountId: string, body: unknown) {
  return new Request("http://localhost/api/calendar/respond", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: buildCookieHeader(accountId)
    },
    body: JSON.stringify(body)
  });
}

describe("resolveCalendarReplySourceMessageRowId", () => {
  test("prefers occurrence message for occurrence replies", () => {
    expect(
      resolveCalendarReplySourceMessageRowId({
        event: {
          messageId: "series-row",
          occurrenceMessageIds: { "123": "occ-row" }
        },
        scope: "occurrence",
        occurrenceStartAtMs: 123
      })
    ).toBe("occ-row");
  });

  test("falls back to series message when occurrence mapping is missing", () => {
    expect(
      resolveCalendarReplySourceMessageRowId({
        event: {
          messageId: "series-row",
          occurrenceMessageIds: {}
        },
        scope: "occurrence",
        occurrenceStartAtMs: 123
      })
    ).toBe("series-row");
  });
});

describe("handleCalendarEventRespondRequest", () => {
  beforeEach(() => {
    lastSentMail = null;
    sendSmtpMessage.mockClear();
    appendImapMessage.mockClear();
  });

  test("threads series RSVP to the source invite chain", async () => {
    const accountId = `acc-calendar-rsvp-series-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const account = buildAccount(accountId);
    const inbox = buildFolder(accountId, `${accountId}:INBOX`, "Inbox", "\\Inbox");
    const sent = buildFolder(accountId, `${accountId}:Sent`, "Sent", "\\Sent");
    const source = buildMessage({
      id: "invite-row",
      accountId,
      folderId: inbox.id,
      messageId: "<invite@example.test>",
      inReplyTo: "<root@example.test>",
      references: ["<older@example.test>", "<root@example.test>"],
      dateValue: Date.UTC(2026, 2, 26, 9, 0, 0)
    });

    await upsertAccount(account);
    await saveFoldersForAccount(accountId, [inbox, sent]);
    await upsertMessages(accountId, inbox.id, [source], true);
    await upsertCalendarEvent(
      accountId,
      buildEvent({
        accountId,
        eventId: "event-series",
        eventUid: "event-series@example.test",
        messageId: source.id
      })
    );

    const response = await handleCalendarEventRespondRequest(
      buildRequest(accountId, { partstat: "ACCEPTED" }),
      { accountId, eventId: "event-series" }
    );
    const body = (await response.json()) as { ok?: boolean };

    expect(body.ok).toBe(true);
    expect(sendSmtpMessage).toHaveBeenCalledTimes(1);
    expect(lastSentMail?.inReplyTo).toBe("<invite@example.test>");
    expect(lastSentMail?.references).toEqual([
      "<older@example.test>",
      "<root@example.test>",
      "<invite@example.test>"
    ]);
  });

  test("threads occurrence RSVP to the occurrence update source", async () => {
    const accountId = `acc-calendar-rsvp-occ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const account = buildAccount(accountId);
    const inbox = buildFolder(accountId, `${accountId}:INBOX`, "Inbox", "\\Inbox");
    const sent = buildFolder(accountId, `${accountId}:Sent`, "Sent", "\\Sent");
    const seriesSource = buildMessage({
      id: "series-row",
      accountId,
      folderId: inbox.id,
      messageId: "<series@example.test>",
      dateValue: Date.UTC(2026, 2, 26, 9, 0, 0)
    });
    const occurrenceSource = buildMessage({
      id: "occurrence-row",
      accountId,
      folderId: inbox.id,
      messageId: "<occurrence@example.test>",
      dateValue: Date.UTC(2026, 2, 27, 9, 0, 0)
    });
    const occurrenceStartAtMs = Date.UTC(2026, 5, 15, 10, 0, 0);

    await upsertAccount(account);
    await saveFoldersForAccount(accountId, [inbox, sent]);
    await upsertMessages(accountId, inbox.id, [seriesSource, occurrenceSource], true);
    await upsertCalendarEvent(
      accountId,
      buildEvent({
        accountId,
        eventId: "event-occurrence",
        eventUid: "event-occurrence@example.test",
        messageId: seriesSource.id,
        occurrenceMessageIds: {
          [String(occurrenceStartAtMs)]: occurrenceSource.id
        },
        recurrenceRule: "FREQ=WEEKLY"
      })
    );

    const response = await handleCalendarEventRespondRequest(
      buildRequest(accountId, {
        partstat: "DECLINED",
        scope: "occurrence",
        occurrenceStartAtMs
      }),
      { accountId, eventId: "event-occurrence" }
    );
    const body = (await response.json()) as { ok?: boolean };

    expect(body.ok).toBe(true);
    expect(lastSentMail?.inReplyTo).toBe("<occurrence@example.test>");
    expect(lastSentMail?.references).toEqual(["<occurrence@example.test>"]);
  });

  test("omits threading headers when the source invite lacks a message id", async () => {
    const accountId = `acc-calendar-rsvp-nomid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const account = buildAccount(accountId);
    const inbox = buildFolder(accountId, `${accountId}:INBOX`, "Inbox", "\\Inbox");
    const sent = buildFolder(accountId, `${accountId}:Sent`, "Sent", "\\Sent");
    const source = buildMessage({
      id: "invite-row-no-mid",
      accountId,
      folderId: inbox.id,
      inReplyTo: "<root@example.test>",
      references: ["<older@example.test>", "<root@example.test>"],
      dateValue: Date.UTC(2026, 2, 26, 9, 0, 0)
    });

    await upsertAccount(account);
    await saveFoldersForAccount(accountId, [inbox, sent]);
    await upsertMessages(accountId, inbox.id, [source], true);
    await upsertCalendarEvent(
      accountId,
      buildEvent({
        accountId,
        eventId: "event-no-mid",
        eventUid: "event-no-mid@example.test",
        messageId: source.id
      })
    );

    const response = await handleCalendarEventRespondRequest(
      buildRequest(accountId, { partstat: "TENTATIVE" }),
      { accountId, eventId: "event-no-mid" }
    );
    const body = (await response.json()) as { ok?: boolean };

    expect(body.ok).toBe(true);
    expect(lastSentMail?.inReplyTo).toBeUndefined();
    expect(lastSentMail?.references).toBeUndefined();
  });
});
