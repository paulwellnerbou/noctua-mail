import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextResponse } from "next/server";

const getMessageById = mock(async () => null);
const getMessageSource = mock(async () => null);
const requireSessionOr401 = mock(() => ({
  userId: "user-1",
  accountId: "acc-1",
  exp: Math.floor(Date.now() / 1000) + 3600
}));
const requireSessionAccountOr403 = mock(() => true);

const actualDb = await import("@/lib/db");
const actualStorage = await import("@/lib/storage");
const actualAuth = await import("@/lib/auth");

mock.module("@/lib/db", () => ({
  ...actualDb,
  getMessageById
}));

mock.module("@/lib/storage", () => ({
  ...actualStorage,
  getMessageSource
}));

mock.module("@/lib/auth", () => ({
  ...actualAuth,
  requireSessionOr401,
  requireSessionAccountOr403
}));

afterAll(() => {
  mock.restore();
});

const { handleGetMessageSourceRequest } = await import("./route");

beforeEach(() => {
  getMessageById.mockReset();
  getMessageSource.mockReset();
  requireSessionOr401.mockReset();
  requireSessionAccountOr403.mockReset();

  requireSessionOr401.mockReturnValue({
    userId: "user-1",
    accountId: "acc-1",
    exp: Math.floor(Date.now() / 1000) + 3600
  });
  requireSessionAccountOr403.mockReturnValue(true);
});

describe("handleGetMessageSourceRequest", () => {
  test("loads source using the canonical message row id", async () => {
    getMessageById.mockResolvedValue({
      id: "imap-2106950294a9471126b68324-d38b2fe765ff",
      accountId: "acc-1",
      folderId: "acc-1:Sent",
      threadId: "thread-1",
      subject: "Self test",
      from: "me@example.test",
      to: "me@example.test",
      preview: "",
      date: new Date().toISOString(),
      dateValue: Date.now(),
      body: "",
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
    });
    getMessageSource.mockImplementation(async (_accountId: string, messageId: string) => {
      return messageId === "imap-2106950294a9471126b68324-d38b2fe765ff"
        ? "raw source"
        : null;
    });

    const response = await handleGetMessageSourceRequest(
      new Request("http://localhost/api/source"),
      {
        accountId: "acc-1",
        messageId: "imap-2106950294a9471126b68324"
      }
    );

    expect(response).toBeInstanceOf(NextResponse);
    expect(getMessageSource).toHaveBeenCalledWith(
      "acc-1",
      "imap-2106950294a9471126b68324-d38b2fe765ff"
    );
    const body = (await response.json()) as { ok?: boolean; source?: string };
    expect(body.ok).toBe(true);
    expect(body.source).toBe("raw source");
  });
});
