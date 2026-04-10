import { randomUUID } from "crypto";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextResponse } from "next/server";
import type { Account, Folder, Message } from "@/lib/data";
import { sealSession, type SessionData } from "@/lib/auth";
import { dbModulePromise } from "@/lib/testDbHarness";

const getImapMailboxStatus = mock(async () => ({
  messages: 0,
  uidNext: null,
  uidValidity: null,
  highestModSeq: null
}));

const actualImap = await import("@/lib/mail/imap");

mock.module("@/lib/mail/imap", () => ({
  ...actualImap,
  getImapMailboxStatus
}));

const { handleFolderConsistencyRequest } = await import("./route");

mock.restore();

function buildFolder(id: string, name: string): Folder {
  return {
    id,
    accountId: id.split(":")[0] ?? "",
    name,
    count: 10,
    unreadCount: 4
  };
}

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
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

function buildMessage(params: {
  accountId: string;
  folderId: string;
  mailboxPath: string;
  imapUid: number;
}): Message {
  return {
    id: `${params.accountId}-message`,
    accountId: params.accountId,
    folderId: params.folderId,
    mailboxPath: params.mailboxPath,
    imapUid: params.imapUid,
    threadId: `${params.accountId}-thread`,
    subject: "Pending move",
    from: "sender@example.com",
    to: "owner@example.com",
    preview: "Pending move",
    date: new Date(Date.UTC(2026, 2, 25, 10, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 2, 25, 10, 0, 0),
    body: "Pending move body",
    unread: true,
    seen: false
  };
}

function buildCookieHeader(accountId: string) {
  const session: SessionData = {
    userId: "user-consistency",
    accountId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60
  };
  return `noctua_session=${encodeURIComponent(sealSession(session))}`;
}

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

beforeEach(() => {
  getImapMailboxStatus.mockReset();
  getImapMailboxStatus.mockResolvedValue({
    messages: 10,
    uidNext: 56,
    uidValidity: "1",
    highestModSeq: "100"
  });
});

describe("folder consistency route pending moves", () => {
  test("suppresses repair for a source folder with pending outbound moves", async () => {
    const accountId = uniqueAccountId("acc-consistency-source");
    const sourceFolder = buildFolder(`${accountId}:Source`, "Source");
    const targetFolder = buildFolder(`${accountId}:Target`, "Target");
    const { saveFoldersForAccount, saveMailboxState, stageMessageMoves, upsertAccount, upsertMessages } =
      await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [sourceFolder, targetFolder]);
    await saveMailboxState({
      accountId,
      folderId: sourceFolder.id,
      mailboxPath: "Source",
      uidValidity: "1",
      highestModSeq: "99",
      highestUid: 55,
      supportsQresync: false
    });
    const message = buildMessage({
      accountId,
      folderId: sourceFolder.id,
      mailboxPath: "Source",
      imapUid: 41
    });
    await upsertMessages(accountId, sourceFolder.id, [message], true);
    await stageMessageMoves({
      accountId,
      messageIds: [message.id],
      destinationFolderId: targetFolder.id,
      destinationMailboxPath: "Target"
    });

    const response = await handleFolderConsistencyRequest(
      new Request("http://localhost/api/folders/consistency", {
        method: "POST",
        headers: {
          cookie: buildCookieHeader(accountId)
        },
        body: JSON.stringify({})
      }),
      { accountId, folderId: sourceFolder.id }
    );

    expect(response).toBeInstanceOf(NextResponse);
    const body = await response.json();
    expect(body.needsRepair).toBe(false);
    expect(body.recommendedMode).toBe("none");
    expect(body.reasons).toEqual([]);
    expect(getImapMailboxStatus).not.toHaveBeenCalled();
  });

  test("suppresses repair for a target folder with pending inbound moves", async () => {
    const accountId = uniqueAccountId("acc-consistency-target");
    const sourceFolder = buildFolder(`${accountId}:Source`, "Source");
    const targetFolder = buildFolder(`${accountId}:Target`, "Target");
    const { saveFoldersForAccount, stageMessageMoves, upsertAccount, upsertMessages } =
      await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [sourceFolder, targetFolder]);
    const message = buildMessage({
      accountId,
      folderId: sourceFolder.id,
      mailboxPath: "Source",
      imapUid: 52
    });
    await upsertMessages(accountId, sourceFolder.id, [message], true);
    await stageMessageMoves({
      accountId,
      messageIds: [message.id],
      destinationFolderId: targetFolder.id,
      destinationMailboxPath: "Target"
    });

    const response = await handleFolderConsistencyRequest(
      new Request("http://localhost/api/folders/consistency", {
        method: "POST",
        headers: {
          cookie: buildCookieHeader(accountId)
        },
        body: JSON.stringify({})
      }),
      { accountId, folderId: targetFolder.id }
    );

    const body = await response.json();
    expect(body.needsRepair).toBe(false);
    expect(body.recommendedMode).toBe("none");
    expect(body.reasons).toEqual([]);
    expect(getImapMailboxStatus).not.toHaveBeenCalled();
  });
});
