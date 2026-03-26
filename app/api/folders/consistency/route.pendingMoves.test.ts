import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextResponse } from "next/server";
import type { Account, Folder } from "@/lib/data";
import { sealSession, type SessionData } from "@/lib/auth";

const getFolders = mock(async () => [] as Folder[]);
const getLatestMessageUid = mock(async () => null);
const getMailboxState = mock(async () => null);
const hasPendingMovesForFolder = mock(async () => false);
const getImapMailboxStatus = mock(async () => ({
  messages: 0,
  uidNext: null,
  uidValidity: null,
  highestModSeq: null
}));

const actualDb = await import("@/lib/db");
const actualImap = await import("@/lib/mail/imap");
const { upsertAccount } = actualDb;

mock.module("@/lib/db", () => ({
  ...actualDb,
  getFolders,
  getLatestMessageUid,
  getMailboxState,
  hasPendingMovesForFolder
}));

mock.module("@/lib/mail/imap", () => ({
  ...actualImap,
  getImapMailboxStatus
}));

afterAll(() => {
  mock.restore();
});

const { handleFolderConsistencyRequest } = await import("./route");

function buildFolder(id: string, name: string): Folder {
  return {
    id,
    accountId: "acc-consistency",
    name,
    count: 10,
    unreadCount: 4
  };
}

function buildAccount(): Account {
  return {
    id: "acc-consistency",
    name: "Consistency",
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

function buildCookieHeader() {
  const session: SessionData = {
    userId: "user-consistency",
    accountId: "acc-consistency",
    exp: Math.floor(Date.now() / 1000) + 60 * 60
  };
  return `noctua_session=${encodeURIComponent(sealSession(session))}`;
}

beforeEach(() => {
  getFolders.mockReset();
  getLatestMessageUid.mockReset();
  getMailboxState.mockReset();
  hasPendingMovesForFolder.mockReset();
  getImapMailboxStatus.mockReset();
  getLatestMessageUid.mockResolvedValue(55);
  getMailboxState.mockResolvedValue({
    uidValidity: "1",
    highestModSeq: "99",
    supportsQresync: false
  });
  getImapMailboxStatus.mockResolvedValue({
    messages: 10,
    uidNext: 56,
    uidValidity: "1",
    highestModSeq: "100"
  });
});

describe("folder consistency route pending moves", () => {
  test("suppresses repair for a source folder with pending outbound moves", async () => {
    await upsertAccount(buildAccount());
    getFolders.mockResolvedValue([buildFolder("acc-consistency:Source", "Source")]);
    hasPendingMovesForFolder.mockResolvedValue(true);

    const response = await handleFolderConsistencyRequest(
      new Request("http://localhost/api/folders/consistency", {
        method: "POST",
        headers: {
          cookie: buildCookieHeader()
        },
        body: JSON.stringify({})
      }),
      { accountId: "acc-consistency", folderId: "acc-consistency:Source" }
    );

    expect(response).toBeInstanceOf(NextResponse);
    const body = await response.json();
    expect(body.needsRepair).toBe(false);
    expect(body.recommendedMode).toBe("none");
    expect(body.reasons).toEqual([]);
    expect(getImapMailboxStatus).not.toHaveBeenCalled();
  });

  test("suppresses repair for a target folder with pending inbound moves", async () => {
    await upsertAccount(buildAccount());
    getFolders.mockResolvedValue([buildFolder("acc-consistency:Target", "Target")]);
    hasPendingMovesForFolder.mockResolvedValue(true);

    const response = await handleFolderConsistencyRequest(
      new Request("http://localhost/api/folders/consistency", {
        method: "POST",
        headers: {
          cookie: buildCookieHeader()
        },
        body: JSON.stringify({})
      }),
      { accountId: "acc-consistency", folderId: "acc-consistency:Target" }
    );

    const body = await response.json();
    expect(body.needsRepair).toBe(false);
    expect(body.recommendedMode).toBe("none");
    expect(body.reasons).toEqual([]);
    expect(getImapMailboxStatus).not.toHaveBeenCalled();
  });
});
