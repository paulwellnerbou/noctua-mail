import { randomUUID } from "crypto";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Account, Folder, Message } from "@/lib/data";
import { sealSession, type SessionData } from "@/lib/auth";
import { dbModulePromise } from "@/lib/testDbHarness";

const updateImapFlagsBulk = mock(async () => {});

const actualServerImap = await import("@/lib/serverImap");

mock.module("@/lib/serverImap", () => ({
  ...actualServerImap,
  updateImapFlagsBulk
}));

const { saveFoldersForAccount, upsertAccount, upsertMessages, getMessageById } = await dbModulePromise;
const { POST } = await import("./route");

mock.restore();

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Bulk Flags Route",
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

function buildFolder(accountId: string): Folder {
  return {
    id: `${accountId}:Inbox`,
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
  imapUid?: number | null;
  mailboxPath?: string;
  flags?: string[];
}): Message {
  return {
    id: params.id,
    accountId: params.accountId,
    folderId: params.folderId,
    threadId: `${params.accountId}-thread`,
    subject: params.id,
    from: "sender@example.test",
    to: "owner@example.test",
    preview: params.id,
    date: new Date(Date.UTC(2026, 2, 25, 9, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 2, 25, 9, 0, 0),
    body: "",
    mailboxPath: params.mailboxPath ?? "INBOX",
    imapUid: params.imapUid ?? undefined,
    attachments: [],
    flags: params.flags ?? [],
    seen: false,
    answered: false,
    flagged: false,
    deleted: false,
    draft: false,
    recent: false,
    unread: true
  };
}

function buildCookieHeader(accountId: string) {
  const session: SessionData = {
    userId: "user-bulk-flags-route",
    accountId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60
  };
  return `noctua_session=${encodeURIComponent(sealSession(session))}`;
}

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

async function postBulkFlags(accountId: string, body: unknown) {
  return POST(
    new Request(`http://localhost/api/accounts/${accountId}/messages/flags/bulk`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: buildCookieHeader(accountId)
      },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ accountId }) }
  );
}

beforeEach(() => {
  updateImapFlagsBulk.mockReset();
  updateImapFlagsBulk.mockResolvedValue(undefined);
});

describe("POST /messages/flags/bulk", () => {
  test("rejects payloads missing the boolean value", async () => {
    const accountId = uniqueAccountId("acc-bulk-flags-no-value");
    await upsertAccount(buildAccount(accountId));
    const response = await postBulkFlags(accountId, { messageIds: ["a"], flag: "seen" });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/value/i);
  });

  test("rejects payloads with no flag and no keyword", async () => {
    const accountId = uniqueAccountId("acc-bulk-flags-no-flag");
    await upsertAccount(buildAccount(accountId));
    const response = await postBulkFlags(accountId, {
      messageIds: ["a"],
      value: true
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean; message: string };
    expect(body.message).toMatch(/flag/i);
  });

  test("rejects empty messageIds", async () => {
    const accountId = uniqueAccountId("acc-bulk-flags-empty");
    await upsertAccount(buildAccount(accountId));
    const response = await postBulkFlags(accountId, {
      messageIds: [],
      flag: "seen",
      value: true
    });
    expect(response.status).toBe(400);
  });

  test("returns 404 when none of the message ids exist", async () => {
    const accountId = uniqueAccountId("acc-bulk-flags-missing");
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [buildFolder(accountId)]);
    const response = await postBulkFlags(accountId, {
      messageIds: ["does-not-exist"],
      flag: "seen",
      value: true
    });
    expect(response.status).toBe(404);
  });

  test("returns 400 with skipped list when no message has IMAP metadata", async () => {
    const accountId = uniqueAccountId("acc-bulk-flags-no-imap");
    const folder = buildFolder(accountId);
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);
    const message = buildMessage({
      id: `${accountId}-msg-1`,
      accountId,
      folderId: folder.id,
      imapUid: null,
      mailboxPath: ""
    });
    await upsertMessages(accountId, folder.id, [message]);

    const response = await postBulkFlags(accountId, {
      messageIds: [message.id],
      flag: "seen",
      value: true
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      ok: boolean;
      skipped: Array<{ messageId: string; reason: string }>;
    };
    expect(body.ok).toBe(false);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0]?.messageId).toBe(message.id);
    expect(updateImapFlagsBulk).not.toHaveBeenCalled();
  });

  test("applies flag to messages with IMAP metadata, returning skipped for those without", async () => {
    const accountId = uniqueAccountId("acc-bulk-flags-mixed");
    const folder = buildFolder(accountId);
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);
    const ready = buildMessage({
      id: `${accountId}-msg-ready`,
      accountId,
      folderId: folder.id,
      imapUid: 101,
      mailboxPath: "INBOX"
    });
    const stale = buildMessage({
      id: `${accountId}-msg-stale`,
      accountId,
      folderId: folder.id,
      imapUid: null,
      mailboxPath: ""
    });
    await upsertMessages(accountId, folder.id, [ready, stale]);

    const response = await postBulkFlags(accountId, {
      messageIds: [ready.id, stale.id],
      flag: "seen",
      value: true
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      results: Array<{ messageId: string; flags: string[] }>;
      skipped: Array<{ messageId: string; reason: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]?.messageId).toBe(ready.id);
    expect(body.results[0]?.flags).toContain("\\Seen");
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0]?.messageId).toBe(stale.id);

    expect(updateImapFlagsBulk).toHaveBeenCalledTimes(1);
    const [, bulkTargets, bulkFlag, bulkValue] = updateImapFlagsBulk.mock.calls[0]!;
    expect(bulkFlag).toBe("\\Seen");
    expect(bulkValue).toBe(true);
    expect(bulkTargets).toEqual([{ mailboxPath: "INBOX", uid: 101 }]);

    const persisted = await getMessageById(accountId, ready.id);
    expect(persisted?.seen).toBe(true);
    expect(persisted?.flags).toContain("\\Seen");
  });

  test("groups multiple uids in the same mailbox into a single bulk STORE", async () => {
    const accountId = uniqueAccountId("acc-bulk-flags-group");
    const folder = buildFolder(accountId);
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);
    const messages = [101, 102, 103].map((uid, i) =>
      buildMessage({
        id: `${accountId}-msg-${i}`,
        accountId,
        folderId: folder.id,
        imapUid: uid,
        mailboxPath: "INBOX"
      })
    );
    await upsertMessages(accountId, folder.id, messages);

    const response = await postBulkFlags(accountId, {
      messageIds: messages.map((m) => m.id),
      flag: "flagged",
      value: true
    });
    expect(response.status).toBe(200);
    expect(updateImapFlagsBulk).toHaveBeenCalledTimes(1);
    const [, bulkTargets] = updateImapFlagsBulk.mock.calls[0]!;
    expect(bulkTargets).toHaveLength(3);
    expect((bulkTargets as Array<{ uid: number }>).map((t) => t.uid).sort()).toEqual([101, 102, 103]);
  });
});
