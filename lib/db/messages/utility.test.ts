import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account, Folder, Message } from "../../data";
import { dbModulePromise } from "../../testDbHarness";

const OWNER_EMAIL = "owner@example.com";

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Suggestion Test Account",
    email: OWNER_EMAIL,
    avatar: "",
    imap: {
      host: "imap.example.com",
      port: 993,
      secure: true,
      user: OWNER_EMAIL,
      password: "secret"
    },
    smtp: {
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: OWNER_EMAIL,
      password: "secret"
    }
  };
}

function buildFolders(accountId: string): { inbox: Folder; sent: Folder } {
  return {
    inbox: {
      id: `${accountId}:INBOX`,
      accountId,
      name: "Inbox",
      count: 0,
      unreadCount: 0,
      specialUse: "\\Inbox"
    },
    sent: {
      id: `${accountId}:Sent`,
      accountId,
      name: "Sent",
      count: 0,
      unreadCount: 0,
      specialUse: "\\Sent"
    }
  };
}

function buildMessage(params: {
  id: string;
  accountId: string;
  folder: Folder;
  from: string;
  to: string;
  dateValue: number;
}): Message {
  return {
    id: params.id,
    accountId: params.accountId,
    folderId: params.folder.id,
    mailboxPath: params.folder.id.slice(params.accountId.length + 1),
    threadId: `${params.id}-thread`,
    messageId: `<${params.id}@example.test>`,
    subject: params.id,
    from: params.from,
    to: params.to,
    preview: params.id,
    date: new Date(params.dateValue).toISOString(),
    dateValue: params.dateValue,
    body: params.id
  };
}

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

async function setupAccount(prefix: string) {
  const accountId = uniqueAccountId(prefix);
  const { saveFoldersForAccount, upsertAccount } = await dbModulePromise;
  await upsertAccount(buildAccount(accountId));
  const folders = buildFolders(accountId);
  await saveFoldersForAccount(accountId, [folders.inbox, folders.sent]);
  return { accountId, ...folders };
}

async function insertMessages(accountId: string, folder: Folder, messages: Message[]) {
  const { upsertMessages } = await dbModulePromise;
  await upsertMessages(accountId, folder.id, messages, true, { recomputeThreads: false });
}

describe("listRecipientSuggestions", () => {
  test("prefers the user's own sent name over a newer variant from received mail", async () => {
    const { accountId, inbox, sent } = await setupAccount("acc-suggestion-own-name");
    await insertMessages(accountId, sent, [
      buildMessage({
        id: "own-sent",
        accountId,
        folder: sent,
        from: `Owner <${OWNER_EMAIL}>`,
        to: '"Julia Oldemeier" <julia@example.test>',
        dateValue: Date.UTC(2026, 6, 29, 11, 0, 0)
      })
    ]);
    await insertMessages(accountId, inbox, [
      buildMessage({
        id: "received-newer",
        accountId,
        folder: inbox,
        from: "colleague@example.test",
        to: `"Jule Oldemeier" <julia@example.test>, Owner <${OWNER_EMAIL}>`,
        dateValue: Date.UTC(2026, 6, 30, 10, 0, 0)
      })
    ]);

    const { listRecipientSuggestions } = await dbModulePromise;
    const suggestions = await listRecipientSuggestions(accountId, 10);
    expect(suggestions).toContain("Julia Oldemeier <julia@example.test>");
    expect(suggestions).not.toContain("Jule Oldemeier <julia@example.test>");
  });

  test("uses the newest own variant after the user corrects a recipient name", async () => {
    const { accountId, sent } = await setupAccount("acc-suggestion-corrected-name");
    await insertMessages(accountId, sent, [
      buildMessage({
        id: "own-sent-old",
        accountId,
        folder: sent,
        from: `Owner <${OWNER_EMAIL}>`,
        to: '"Jule Oldemeier" <julia@example.test>',
        dateValue: Date.UTC(2026, 6, 20, 9, 0, 0)
      }),
      buildMessage({
        id: "own-sent-corrected",
        accountId,
        folder: sent,
        from: `Owner <${OWNER_EMAIL}>`,
        to: '"Julia Oldemeier" <julia@example.test>',
        dateValue: Date.UTC(2026, 6, 29, 11, 0, 0)
      })
    ]);

    const { listRecipientSuggestions } = await dbModulePromise;
    const suggestions = await listRecipientSuggestions(accountId, 10);
    expect(suggestions).toContain("Julia Oldemeier <julia@example.test>");
  });

  test("falls back to names from received mail when the user never typed one", async () => {
    const { accountId, inbox, sent } = await setupAccount("acc-suggestion-fallback-name");
    await insertMessages(accountId, inbox, [
      buildMessage({
        id: "received-named",
        accountId,
        folder: inbox,
        from: "colleague@example.test",
        to: `"Theo Wellner" <theo@example.test>, Owner <${OWNER_EMAIL}>`,
        dateValue: Date.UTC(2026, 6, 20, 9, 0, 0)
      })
    ]);
    await insertMessages(accountId, sent, [
      buildMessage({
        id: "own-sent-bare",
        accountId,
        folder: sent,
        from: `Owner <${OWNER_EMAIL}>`,
        to: "theo@example.test",
        dateValue: Date.UTC(2026, 6, 29, 11, 0, 0)
      })
    ]);

    const { listRecipientSuggestions } = await dbModulePromise;
    const suggestions = await listRecipientSuggestions(accountId, 10);
    expect(suggestions).toContain("Theo Wellner <theo@example.test>");
  });
});
