import { randomUUID } from "crypto";
import { describe, expect, mock, test } from "bun:test";
import type { Account } from "@/lib/data";
import { sealSession, type SessionData } from "@/lib/auth";
import { markImapConnectFailure } from "@/lib/mail/imapError";
import { dbModulePromise } from "@/lib/testDbHarness";
import { MAIL_SERVER_UNREACHABLE_MESSAGE } from "@/app/api/_helpers/imapUpstreamError";

const actualImap = await import("@/lib/mail/imap");

// mock.module registrations outlive this file, so the mock delegates to the
// real implementation by default; tests override it with *Once values only.
const planImapNewSyncFolders = mock(actualImap.planImapNewSyncFolders);

mock.module("@/lib/mail/imap", () => ({
  ...actualImap,
  planImapNewSyncFolders
}));

const { upsertAccount } = await dbModulePromise;
const { POST } = await import("./route");

mock.restore();

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "New Candidates Route",
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

function buildSession(accountId: string): SessionData {
  return {
    userId: "user-new-candidates-tests",
    accountId,
    role: "user",
    exp: Math.floor(Date.now() / 1000) + 60 * 60
  };
}

function buildRequest(accountId: string) {
  return new Request(`http://localhost/api/accounts/${accountId}/sync/new-candidates`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `noctua_session=${encodeURIComponent(sealSession(buildSession(accountId)))}`
    },
    body: JSON.stringify({ folderIds: [] })
  });
}

async function setUpAccount() {
  const accountId = `acc-new-candidates-${randomUUID()}`;
  await upsertAccount(buildAccount(accountId));
  return accountId;
}

describe("sync new-candidates route", () => {
  test("returns planned decisions", async () => {
    const accountId = await setUpAccount();
    const decision = {
      folderId: `${accountId}:INBOX`,
      mailboxPath: "INBOX",
      uidNext: 42,
      skip: false,
      reason: "has-new-uids"
    };
    planImapNewSyncFolders.mockResolvedValueOnce([decision]);

    const response = await POST(buildRequest(accountId), {
      params: Promise.resolve({ accountId })
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok?: boolean; decisions?: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.decisions).toEqual([decision]);
  });

  test("maps IMAP connect failures to a 503 with a user-facing message", async () => {
    const accountId = await setUpAccount();
    planImapNewSyncFolders.mockRejectedValueOnce(
      markImapConnectFailure(
        new Error('Peer certificate is empty for hostname "imap.example.test"')
      )
    );

    const response = await POST(buildRequest(accountId), {
      params: Promise.resolve({ accountId })
    });

    expect(response.status).toBe(503);
    const body = (await response.json()) as { ok?: boolean; message?: string };
    expect(body.ok).toBe(false);
    expect(body.message).toBe(MAIL_SERVER_UNREACHABLE_MESSAGE);
    expect(body.message).not.toContain("Peer certificate");
  });

  test("rethrows local failures instead of misreporting them as an outage", async () => {
    const accountId = await setUpAccount();
    planImapNewSyncFolders.mockRejectedValueOnce(new Error("db is locked"));

    expect(
      POST(buildRequest(accountId), { params: Promise.resolve({ accountId }) })
    ).rejects.toThrow("db is locked");
  });

  test("keeps reauth semantics for IMAP auth failures", async () => {
    const accountId = await setUpAccount();
    planImapNewSyncFolders.mockRejectedValueOnce(
      Object.assign(new Error("Command failed"), { authenticationFailed: true })
    );

    const response = await POST(buildRequest(accountId), {
      params: Promise.resolve({ accountId })
    });

    expect(response.status).toBe(401);
    const body = (await response.json()) as {
      ok?: boolean;
      code?: string;
      reauthRequired?: boolean;
      accountId?: string;
    };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("imap_auth_failed");
    expect(body.reauthRequired).toBe(true);
    expect(body.accountId).toBe(accountId);
  });
});
