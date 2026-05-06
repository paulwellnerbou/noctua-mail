import { randomUUID } from "crypto";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Account } from "@/lib/data";
import { sealSession, type SessionData } from "@/lib/auth";
import { dbModulePromise } from "@/lib/testDbHarness";
import type { StoredMessageSummary } from "@/lib/db/messages/retrieval";
import type {
  BulkFlagMutationResult,
  BulkFlagMutationTarget
} from "@/lib/messageFlagMutation";

// `@/lib/db` and `@/lib/messageFlagMutation` are stubbed at the module level
// so this test exercises the route's payload validation, target filtering,
// and response shape without depending on the shared test DB. (Other test
// files mock `getStoredMessagesByIds`, and Bun's `mock.restore()` does not
// undo `mock.module` registrations, so this test would otherwise observe
// stale stubs from those files.)

let storedRows: StoredMessageSummary[] = [];
const getStoredMessagesByIds = mock(async () => storedRows);
const applyFlagMutationsToMessages = mock(
  async (_params: Parameters<
    typeof import("@/lib/messageFlagMutation").applyFlagMutationsToMessages
  >[0]): Promise<BulkFlagMutationResult[]> => []
);

const actualDb = await import("@/lib/db");
const actualMfm = await import("@/lib/messageFlagMutation");

mock.module("@/lib/db", () => ({
  ...actualDb,
  getStoredMessagesByIds
}));
mock.module("@/lib/messageFlagMutation", () => ({
  ...actualMfm,
  applyFlagMutationsToMessages
}));

const { upsertAccount } = await dbModulePromise;
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
  storedRows = [];
  getStoredMessagesByIds.mockClear();
  getStoredMessagesByIds.mockImplementation(async () => storedRows);
  applyFlagMutationsToMessages.mockReset();
  applyFlagMutationsToMessages.mockResolvedValue([]);
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
    storedRows = [];
    const response = await postBulkFlags(accountId, {
      messageIds: ["does-not-exist"],
      flag: "seen",
      value: true
    });
    expect(response.status).toBe(404);
    expect(applyFlagMutationsToMessages).not.toHaveBeenCalled();
  });

  test("returns 400 with skipped list when no message has IMAP metadata", async () => {
    const accountId = uniqueAccountId("acc-bulk-flags-no-imap");
    await upsertAccount(buildAccount(accountId));
    const messageId = `${accountId}-msg-1`;
    storedRows = [
      {
        id: messageId,
        messageId,
        folderId: `${accountId}:Inbox`,
        mailboxPath: null,
        imapUid: null,
        flags: [],
        threadId: `${accountId}-thread`
      }
    ];

    const response = await postBulkFlags(accountId, {
      messageIds: [messageId],
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
    expect(body.skipped[0]?.messageId).toBe(messageId);
    expect(applyFlagMutationsToMessages).not.toHaveBeenCalled();
  });

  test("applies flag to messages with IMAP metadata, returning skipped for those without", async () => {
    const accountId = uniqueAccountId("acc-bulk-flags-mixed");
    await upsertAccount(buildAccount(accountId));
    const readyId = `${accountId}-msg-ready`;
    const staleId = `${accountId}-msg-stale`;
    storedRows = [
      {
        id: readyId,
        messageId: readyId,
        folderId: `${accountId}:Inbox`,
        mailboxPath: "INBOX",
        imapUid: 101,
        flags: [],
        threadId: `${accountId}-thread`
      },
      {
        id: staleId,
        messageId: staleId,
        folderId: `${accountId}:Inbox`,
        mailboxPath: null,
        imapUid: null,
        flags: [],
        threadId: `${accountId}-thread`
      }
    ];
    applyFlagMutationsToMessages.mockResolvedValue([
      { messageId: readyId, flags: ["\\Seen"] }
    ]);

    const response = await postBulkFlags(accountId, {
      messageIds: [readyId, staleId],
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
    expect(body.results).toEqual([{ messageId: readyId, flags: ["\\Seen"] }]);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0]?.messageId).toBe(staleId);

    expect(applyFlagMutationsToMessages).toHaveBeenCalledTimes(1);
    const [callParams] = applyFlagMutationsToMessages.mock.calls[0]!;
    expect(callParams.flag).toBe("seen");
    expect(callParams.value).toBe(true);
    expect(callParams.targets).toEqual([
      {
        messageId: readyId,
        mailboxPath: "INBOX",
        imapUid: 101,
        flags: [],
        threadId: `${accountId}-thread`
      } satisfies BulkFlagMutationTarget
    ]);
  });

  test("forwards every well-formed target so the service layer can group by mailbox", async () => {
    const accountId = uniqueAccountId("acc-bulk-flags-group");
    await upsertAccount(buildAccount(accountId));
    storedRows = [101, 102, 103].map((uid, i) => ({
      id: `${accountId}-msg-${i}`,
      messageId: `${accountId}-msg-${i}`,
      folderId: `${accountId}:Inbox`,
      mailboxPath: "INBOX",
      imapUid: uid,
      flags: [],
      threadId: `${accountId}-thread`
    }));

    const response = await postBulkFlags(accountId, {
      messageIds: storedRows.map((r) => r.id),
      flag: "flagged",
      value: true
    });
    expect(response.status).toBe(200);
    expect(applyFlagMutationsToMessages).toHaveBeenCalledTimes(1);
    const [callParams] = applyFlagMutationsToMessages.mock.calls[0]!;
    expect(callParams.targets).toHaveLength(3);
    expect(callParams.targets.map((t) => t.imapUid).sort()).toEqual([101, 102, 103]);
    expect(callParams.targets.every((t) => t.mailboxPath === "INBOX")).toBe(true);
  });

  test("maps `Unknown flag` from the service layer to a 400", async () => {
    const accountId = uniqueAccountId("acc-bulk-flags-unknown");
    await upsertAccount(buildAccount(accountId));
    storedRows = [
      {
        id: `${accountId}-msg-1`,
        messageId: `${accountId}-msg-1`,
        folderId: `${accountId}:Inbox`,
        mailboxPath: "INBOX",
        imapUid: 1,
        flags: [],
        threadId: `${accountId}-thread`
      }
    ];
    applyFlagMutationsToMessages.mockRejectedValue(new Error("Unknown flag"));

    const response = await postBulkFlags(accountId, {
      messageIds: storedRows.map((r) => r.id),
      flag: "seen",
      value: true
    });
    expect(response.status).toBe(400);
  });

  test("maps unexpected service-layer errors to a 502", async () => {
    const accountId = uniqueAccountId("acc-bulk-flags-imap-error");
    await upsertAccount(buildAccount(accountId));
    storedRows = [
      {
        id: `${accountId}-msg-1`,
        messageId: `${accountId}-msg-1`,
        folderId: `${accountId}:Inbox`,
        mailboxPath: "INBOX",
        imapUid: 1,
        flags: [],
        threadId: `${accountId}-thread`
      }
    ];
    applyFlagMutationsToMessages.mockRejectedValue(new Error("imap connect refused"));

    const response = await postBulkFlags(accountId, {
      messageIds: storedRows.map((r) => r.id),
      flag: "seen",
      value: true
    });
    expect(response.status).toBe(502);
  });
});
