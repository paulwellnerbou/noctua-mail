import { randomUUID } from "crypto";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Account } from "@/lib/data";
import { sealSession, type SessionData } from "@/lib/auth";
import { dbModulePromise } from "@/lib/testDbHarness";
import type { StoredMessageSummary } from "@/lib/db/messages/retrieval";
import { applyFlagMutationsToMessages } from "@/lib/messageFlagMutation";

// `@/lib/db` (only `getStoredMessagesByIds`), `@/lib/serverImap` (only
// `updateImapFlagsBulk`) and `@/lib/serverDb` (only `bulkUpdateMessageFlags` /
// `recomputeThreadsForAccount`) are stubbed at the module level. The route
// runs against the real `applyFlagMutationsToMessages` so this file covers
// both the route surface (payload validation, target filtering, response
// shape, status mapping) and the service-layer behaviour (per-mailbox
// grouping, IMAP-then-DB ordering, partial failure durability) without
// the cross-file `mock.module` leakage that made splitting the suite
// difficult.

let storedRows: StoredMessageSummary[] = [];
const getStoredMessagesByIds = mock(async () => storedRows);
const updateImapFlagsBulk = mock(async () => {});
const bulkUpdateMessageFlags = mock(async () => {});
const recomputeThreadsForAccount = mock(async () => {});

const actualDb = await import("@/lib/db");
const actualServerImap = await import("@/lib/serverImap");
const actualServerDb = await import("@/lib/serverDb");

mock.module("@/lib/db", () => ({
  ...actualDb,
  getStoredMessagesByIds
}));
mock.module("@/lib/serverImap", () => ({
  ...actualServerImap,
  updateImapFlagsBulk
}));
mock.module("@/lib/serverDb", () => ({
  ...actualServerDb,
  bulkUpdateMessageFlags,
  recomputeThreadsForAccount
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
  updateImapFlagsBulk.mockReset();
  updateImapFlagsBulk.mockResolvedValue(undefined);
  bulkUpdateMessageFlags.mockReset();
  bulkUpdateMessageFlags.mockResolvedValue(undefined);
  recomputeThreadsForAccount.mockReset();
  recomputeThreadsForAccount.mockResolvedValue(undefined);
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
    expect(updateImapFlagsBulk).not.toHaveBeenCalled();
  });

  test("returns 404 when a partial subset of message ids is missing", async () => {
    const accountId = uniqueAccountId("acc-bulk-flags-partial");
    await upsertAccount(buildAccount(accountId));
    const presentId = `${accountId}-msg-present`;
    const missingId = `${accountId}-msg-missing`;
    storedRows = [
      {
        id: presentId,
        messageId: presentId,
        folderId: `${accountId}:Inbox`,
        mailboxPath: "INBOX",
        imapUid: 1,
        flags: [],
        threadId: `${accountId}-thread`
      }
    ];
    const response = await postBulkFlags(accountId, {
      messageIds: [presentId, missingId],
      flag: "seen",
      value: true
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { ok: boolean; missingIds: string[] };
    expect(body.ok).toBe(false);
    expect(body.missingIds).toEqual([missingId]);
    expect(updateImapFlagsBulk).not.toHaveBeenCalled();
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
    expect(updateImapFlagsBulk).not.toHaveBeenCalled();
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

    expect(updateImapFlagsBulk).toHaveBeenCalledTimes(1);
    const [, bulkTargets, flag, enable] = updateImapFlagsBulk.mock.calls[0]!;
    expect(flag).toBe("\\Seen");
    expect(enable).toBe(true);
    expect(bulkTargets).toEqual([{ mailboxPath: "INBOX", uid: 101 }]);
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
    // All three messages share the same mailbox, so a single STORE covers them.
    expect(updateImapFlagsBulk).toHaveBeenCalledTimes(1);
    const [, bulkTargets] = updateImapFlagsBulk.mock.calls[0]!;
    expect((bulkTargets as Array<{ uid: number }>).map((t) => t.uid).sort()).toEqual([101, 102, 103]);
    expect((bulkTargets as Array<{ mailboxPath: string }>).every((t) => t.mailboxPath === "INBOX")).toBe(true);
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
    // Real applyFlagMutationsToMessages → buildFlagMutations returns []
    // because "bogus" is not a known flag → throws "Unknown flag" → route 400.
    const response = await postBulkFlags(accountId, {
      messageIds: storedRows.map((r) => r.id),
      flag: "bogus",
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
    updateImapFlagsBulk.mockRejectedValue(new Error("imap connect refused"));

    const response = await postBulkFlags(accountId, {
      messageIds: storedRows.map((r) => r.id),
      flag: "seen",
      value: true
    });
    expect(response.status).toBe(502);
  });
});

// Unit tests for the service function. The route describe block above
// mocks `@/lib/serverImap.updateImapFlagsBulk` and the relevant `serverDb`
// exports — those are exactly the dependencies `applyFlagMutationsToMessages`
// reaches for, so we can call the real implementation with the mocks already
// in place via `mock.module`.
const serviceAccount: Account = buildAccount("acc-flag-mut-service");

describe("applyFlagMutationsToMessages", () => {
  test("issues one IMAP STORE per mailbox group with that group's UIDs", async () => {
    await applyFlagMutationsToMessages(
      {
        accountId: serviceAccount.id,
        account: serviceAccount,
        flag: "seen",
        value: true,
        targets: [
          { messageId: "m1", mailboxPath: "INBOX", imapUid: 101, flags: [], threadId: "t1" },
          { messageId: "m2", mailboxPath: "INBOX", imapUid: 102, flags: [], threadId: "t1" },
          { messageId: "m3", mailboxPath: "Archive", imapUid: 50, flags: [], threadId: "t2" }
        ]
      }
    );

    expect(updateImapFlagsBulk).toHaveBeenCalledTimes(2);
    const calls = updateImapFlagsBulk.mock.calls.map((args) => ({
      targets: args[1],
      flag: args[2],
      enable: args[3]
    }));
    const inboxCall = calls.find((c) => (c.targets as Array<{ mailboxPath: string }>)[0].mailboxPath === "INBOX");
    const archiveCall = calls.find((c) => (c.targets as Array<{ mailboxPath: string }>)[0].mailboxPath === "Archive");
    expect(inboxCall?.flag).toBe("\\Seen");
    expect(inboxCall?.enable).toBe(true);
    expect((inboxCall?.targets as Array<{ uid: number }>).map((t) => t.uid).sort()).toEqual([101, 102]);
    expect((archiveCall?.targets as Array<{ uid: number }>).map((t) => t.uid)).toEqual([50]);
  });

  test("commits DB and recomputes threads after each successful mailbox group", async () => {
    await applyFlagMutationsToMessages(
      {
        accountId: serviceAccount.id,
        account: serviceAccount,
        flag: "flagged",
        value: true,
        targets: [
          { messageId: "m1", mailboxPath: "INBOX", imapUid: 1, flags: [], threadId: "t-inbox" },
          { messageId: "m2", mailboxPath: "Archive", imapUid: 2, flags: [], threadId: "t-archive" }
        ]
      }
    );

    expect(bulkUpdateMessageFlags).toHaveBeenCalledTimes(2);
    expect(recomputeThreadsForAccount).toHaveBeenCalledTimes(2);
    const recomputeArgs = recomputeThreadsForAccount.mock.calls.map((c) => c[1]);
    expect(recomputeArgs).toContainEqual(["t-inbox"]);
    expect(recomputeArgs).toContainEqual(["t-archive"]);
  });

  test("preserves earlier mailbox group's DB writes when a later group's IMAP STORE throws", async () => {
    let imapCalls = 0;
    updateImapFlagsBulk.mockImplementation(async () => {
      imapCalls += 1;
      if (imapCalls > 1) throw new Error("imap connection refused");
    });

    await expect(
      applyFlagMutationsToMessages(
        {
          accountId: serviceAccount.id,
          account: serviceAccount,
          flag: "seen",
          value: true,
          targets: [
            { messageId: "m1", mailboxPath: "INBOX", imapUid: 1, flags: [], threadId: "t-inbox" },
            { messageId: "m2", mailboxPath: "Archive", imapUid: 2, flags: [], threadId: "t-archive" }
          ]
        }
    )
    ).rejects.toThrow("imap connection refused");

    expect(bulkUpdateMessageFlags).toHaveBeenCalledTimes(1);
    expect(bulkUpdateMessageFlags.mock.calls[0]![1]).toEqual([
      { id: "m1", flags: ["\\Seen"] }
    ]);
    expect(recomputeThreadsForAccount).toHaveBeenCalledTimes(1);
    expect(recomputeThreadsForAccount.mock.calls[0]![1]).toEqual(["t-inbox"]);
  });

  test("does not write to DB if IMAP STORE for the only mailbox group throws", async () => {
    updateImapFlagsBulk.mockRejectedValue(new Error("STORE rejected"));

    await expect(
      applyFlagMutationsToMessages(
        {
          accountId: serviceAccount.id,
          account: serviceAccount,
          flag: "seen",
          value: true,
          targets: [
            { messageId: "m1", mailboxPath: "INBOX", imapUid: 1, flags: [], threadId: "t-inbox" }
          ]
        }
    )
    ).rejects.toThrow("STORE rejected");

    expect(bulkUpdateMessageFlags).not.toHaveBeenCalled();
    expect(recomputeThreadsForAccount).not.toHaveBeenCalled();
  });

  test("rejects targets with missing IMAP metadata before any work", async () => {
    await expect(
      applyFlagMutationsToMessages(
        {
          accountId: serviceAccount.id,
          account: serviceAccount,
          flag: "seen",
          value: true,
          targets: [
            { messageId: "m1", mailboxPath: "INBOX", imapUid: 1, flags: [] },
            { messageId: "m2", mailboxPath: "", imapUid: 2, flags: [] }
          ]
        }
    )
    ).rejects.toThrow("Message is missing IMAP metadata");

    expect(updateImapFlagsBulk).not.toHaveBeenCalled();
    expect(bulkUpdateMessageFlags).not.toHaveBeenCalled();
  });

  test("issues two STOREs for `answered: true` (also sets \\Seen)", async () => {
    await applyFlagMutationsToMessages(
      {
        accountId: serviceAccount.id,
        account: serviceAccount,
        flag: "answered",
        value: true,
        targets: [
          { messageId: "m1", mailboxPath: "INBOX", imapUid: 1, flags: [], threadId: "t" }
        ]
      }
    );

    expect(updateImapFlagsBulk).toHaveBeenCalledTimes(2);
    const flags = updateImapFlagsBulk.mock.calls.map((c) => c[2]);
    expect(flags).toEqual(["\\Answered", "\\Seen"]);
    expect(bulkUpdateMessageFlags).toHaveBeenCalledTimes(1);
    expect(bulkUpdateMessageFlags.mock.calls[0]![1]).toEqual([
      { id: "m1", flags: ["\\Answered", "\\Seen"] }
    ]);
  });

  test("skips recompute when no target has a thread id", async () => {
    await applyFlagMutationsToMessages(
      {
        accountId: serviceAccount.id,
        account: serviceAccount,
        flag: "seen",
        value: true,
        targets: [{ messageId: "m1", mailboxPath: "INBOX", imapUid: 1, flags: [] }]
      }
    );

    expect(bulkUpdateMessageFlags).toHaveBeenCalledTimes(1);
    expect(recomputeThreadsForAccount).not.toHaveBeenCalled();
  });

  test("throws `Unknown flag` for an unrecognized flag key", async () => {
    await expect(
      applyFlagMutationsToMessages(
        {
          accountId: serviceAccount.id,
          account: serviceAccount,
          flag: "bogus" as never,
          value: true,
          targets: [{ messageId: "m1", mailboxPath: "INBOX", imapUid: 1, flags: [] }]
        }
    )
    ).rejects.toThrow("Unknown flag");

    expect(updateImapFlagsBulk).not.toHaveBeenCalled();
    expect(bulkUpdateMessageFlags).not.toHaveBeenCalled();
  });
});
