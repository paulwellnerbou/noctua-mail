import { describe, expect, test } from "bun:test";
import { NextResponse } from "next/server";
import type { Account, Folder, Message } from "@/lib/data";
import { sealSession, type SessionData } from "@/lib/auth";
import { saveMessageSource } from "@/lib/storage";
import { dbModulePromise } from "@/lib/testDbHarness";

const { saveFoldersForAccount, upsertAccount, upsertMessages } = await dbModulePromise;
const { handleGetMessageSourceRequest } = await import("./route");

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Source Route Test",
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
    id: `${accountId}:Sent`,
    accountId,
    name: "Sent",
    count: 1,
    unreadCount: 0,
    specialUse: "\\Sent"
  };
}

function buildMessage(accountId: string, folderId: string): Message {
  return {
    id: "imap-2106950294a9471126b68324-d38b2fe765ff",
    accountId,
    folderId,
    threadId: `${accountId}-thread-1`,
    subject: "Self test",
    from: "owner@example.test",
    to: "owner@example.test",
    preview: "",
    date: new Date(Date.UTC(2026, 2, 26, 9, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 2, 26, 9, 0, 0),
    body: "",
    mailboxPath: "Sent",
    imapUid: 1,
    attachments: [],
    unread: false,
    flags: [],
    seen: true,
    answered: false,
    flagged: false,
    deleted: false,
    draft: false,
    recent: false,
    hasSource: true
  };
}

function buildCookieHeader(accountId: string) {
  const session: SessionData = {
    userId: "user-source-route",
    accountId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60
  };
  return `noctua_session=${encodeURIComponent(sealSession(session))}`;
}

describe("handleGetMessageSourceRequest", () => {
  test("loads stored source for an authorized message", async () => {
    const accountId = "acc-source-route";
    const folder = buildFolder(accountId);
    const message = buildMessage(accountId, folder.id);
    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);
    await upsertMessages(accountId, folder.id, [message]);
    await saveMessageSource(accountId, message.id, "raw source");

    const response = await handleGetMessageSourceRequest(
      new Request("http://localhost/api/source", {
        headers: {
          cookie: buildCookieHeader(accountId)
        }
      }),
      {
        accountId,
        messageId: message.id
      }
    );

    expect(response).toBeInstanceOf(NextResponse);
    const body = (await response.json()) as { ok?: boolean; source?: string };
    expect(body.ok).toBe(true);
    expect(body.source).toBe("raw source");
  });
});
