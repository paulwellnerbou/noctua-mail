import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ComposeInviteDraft } from "@/lib/composeInvite";
import type { Account, Folder, Message } from "@/lib/data";
import { COMPOSE_INVITE_HEADER, decodeComposeInviteHeader } from "@/lib/composeInviteMetadata";
import { dbModulePromise } from "@/lib/testDbHarness";

type BuiltDraftMail = {
  to?: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  xForwardedMessageId?: string;
  headers?: Record<string, string>;
};

let lastBuiltDraftMail: BuiltDraftMail | null = null;

const buildRawMessage = mock(async (_account: Account, mail: BuiltDraftMail) => {
  lastBuiltDraftMail = mail;
  return `raw:${mail.subject}`;
});
const appendImapMessage = mock(async () => 9001);
const deleteImapMessage = mock(async () => {});
const syncImapMessage = mock(async (account: Account, mailboxPath: string, uid: number) => {
  const mail = lastBuiltDraftMail;
  return {
    id: `${account.id}-draft-${uid}`,
    accountId: account.id,
    folderId: `${account.id}:Drafts`,
    threadId: `<raw-draft-thread-${uid}@example.test>`,
    messageId: `<draft-${uid}@example.test>`,
    inReplyTo: mail?.inReplyTo,
    references: mail?.references,
    xForwardedMessageId: mail?.xForwardedMessageId,
    subject: mail?.subject ?? "",
    from: account.email,
    to: mail?.to ?? "",
    cc: mail?.cc,
    bcc: mail?.bcc,
    preview: mail?.subject ?? "",
    date: new Date(Date.UTC(2026, 2, 26, 15, 12, 0)).toISOString(),
    dateValue: Date.UTC(2026, 2, 26, 15, 12, 0),
    body: mail?.text ?? "",
    htmlBody: mail?.html,
    mailboxPath,
    imapUid: uid,
    flags: ["\\Draft", "\\Seen"],
    draft: true,
    attachments: []
  } satisfies Message;
});

const actualImap = await import("@/lib/mail/imap");
const actualSmtp = await import("@/lib/mail/smtp");

mock.module("@/lib/mail/imap", () => ({
  ...actualImap,
  appendImapMessage,
  deleteImapMessage,
  syncImapMessage
}));

mock.module("@/lib/mail/smtp", () => ({
  ...actualSmtp,
  buildRawMessage
}));

const { getMessageById, saveFoldersForAccount, upsertAccount, upsertMessages } =
  await dbModulePromise;
const { buildDraftInputForMode, saveDraftForAccount } = await import("./drafts");

mock.restore();

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Draft Test",
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

function buildInboxFolder(accountId: string): Folder {
  return {
    id: `${accountId}:INBOX`,
    accountId,
    name: "Inbox",
    count: 0,
    unreadCount: 0,
    specialUse: "\\Inbox"
  };
}

function buildDraftsFolder(accountId: string): Folder {
  return {
    id: `${accountId}:Drafts`,
    accountId,
    name: "Drafts",
    count: 0,
    unreadCount: 0,
    specialUse: "\\Drafts"
  };
}

function buildMessage(params: {
  id: string;
  accountId: string;
  folderId: string;
  threadId: string;
  messageId: string;
  subject: string;
  from: string;
  to: string;
  dateValue: number;
  imapUid: number;
}): Message {
  return {
    id: params.id,
    accountId: params.accountId,
    folderId: params.folderId,
    threadId: params.threadId,
    messageId: params.messageId,
    subject: params.subject,
    from: params.from,
    to: params.to,
    preview: params.subject,
    date: new Date(params.dateValue).toISOString(),
    dateValue: params.dateValue,
    body: params.subject,
    mailboxPath: "INBOX",
    imapUid: params.imapUid,
    flags: []
  };
}

describe("saveDraftForAccount", () => {
  beforeEach(() => {
    lastBuiltDraftMail = null;
    buildRawMessage.mockClear();
    appendImapMessage.mockClear();
    deleteImapMessage.mockClear();
    syncImapMessage.mockClear();
  });

  test("resolves forward drafts into the existing thread before returning them to the UI", async () => {
    const accountId = `acc-drafts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const account = buildAccount(accountId);
    const inbox = buildInboxFolder(accountId);
    const drafts = buildDraftsFolder(accountId);
    const original = buildMessage({
      id: "original-row",
      accountId,
      folderId: inbox.id,
      threadId: "<thread-root@example.test>",
      messageId: "<original@example.test>",
      subject: "Topic anchor",
      from: "Janine <janine@example.test>",
      to: "owner@example.test",
      dateValue: Date.UTC(2026, 2, 26, 11, 36, 0),
      imapUid: 101
    });

    await upsertAccount(account);
    await saveFoldersForAccount(accountId, [inbox, drafts]);
    await upsertMessages(accountId, inbox.id, [original], true);

    const payload = await buildDraftInputForMode(account, accountId, {
      mode: "forward",
      messageId: original.id,
      text: "Forward body"
    });

    const result = await saveDraftForAccount({
      account,
      accountId,
      clientId: "draft-test-client",
      payload
    });

    expect(buildRawMessage).toHaveBeenCalledTimes(1);
    expect(lastBuiltDraftMail?.inReplyTo).toBe(original.messageId);
    expect(lastBuiltDraftMail?.references).toEqual([original.messageId]);
    expect(lastBuiltDraftMail?.xForwardedMessageId).toBe(original.messageId);

    expect(result.message?.threadId).toBe(original.threadId);
    expect(result.message?.parentId).toBe(original.id);

    const storedDraftId = result.draftId;
    expect(storedDraftId).toBeTruthy();
    const stored = await getMessageById(accountId, storedDraftId!);
    expect(stored?.threadId).toBe(original.threadId);
    expect(stored?.parentId).toBe(original.id);
    expect(stored?.xForwardedMessageId).toBe(original.messageId);
  });

  test("persists invite draft metadata in the raw draft headers and returned message", async () => {
    const accountId = `acc-drafts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const account = buildAccount(accountId);
    const drafts = buildDraftsFolder(accountId);
    const invite: ComposeInviteDraft = {
      location: "Home office",
      start: "2026-03-26T09:00",
      end: "2026-03-26T10:00",
      allDay: false,
      recurrenceRule: "FREQ=WEEKLY"
    };

    await upsertAccount(account);
    await saveFoldersForAccount(accountId, [drafts]);

    const result = await saveDraftForAccount({
      account,
      accountId,
      clientId: "draft-test-client",
      payload: {
        to: "owner@example.test",
        subject: "Invite draft",
        text: "Body",
        invite
      }
    });

    expect(lastBuiltDraftMail?.headers?.[COMPOSE_INVITE_HEADER]).toBeTruthy();
    expect(decodeComposeInviteHeader(lastBuiltDraftMail?.headers?.[COMPOSE_INVITE_HEADER])).toEqual(
      invite
    );
    expect(result.message?.draftInvite).toEqual(invite);
  });
});
