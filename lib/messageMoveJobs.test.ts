import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { Account } from "@/lib/data";

const updateMessageFolder = mock(async () => undefined);
const moveImapMessages = mock(async () => new Map<number, number | null>());

const actualDb = await import("./db");
const actualImap = await import("./mail/imap");
const { upsertAccount } = actualDb;

mock.module("@/lib/db", () => ({
  ...actualDb,
  updateMessageFolder
}));

mock.module("@/lib/mail/imap", () => ({
  ...actualImap,
  moveImapMessages
}));

afterAll(() => {
  mock.restore();
});

const {
  enqueueMessageMoveJobs,
  waitForMessageMoveJobsIdle
} = await import("./messageMoveJobs");

const account: Account = {
  id: "acc-move-jobs",
  name: "Move Jobs",
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

beforeEach(async () => {
  updateMessageFolder.mockReset();
  moveImapMessages.mockReset();
  await upsertAccount(account);
  await waitForMessageMoveJobsIdle(account.id);
});

describe("message move jobs", () => {
  test("batches moves by source and destination mailbox", async () => {
    moveImapMessages.mockResolvedValue(
      new Map([
        [10, 110],
        [11, 111],
        [12, 112]
      ])
    );

    enqueueMessageMoveJobs([
      {
        accountId: account.id,
        messageId: "m-1",
        sourceFolderId: "acc:Source",
        sourceMailboxPath: "Source",
        sourceUid: 10,
        destinationFolderId: "acc:Target",
        destinationMailboxPath: "Target"
      },
      {
        accountId: account.id,
        messageId: "m-2",
        sourceFolderId: "acc:Source",
        sourceMailboxPath: "Source",
        sourceUid: 11,
        destinationFolderId: "acc:Target",
        destinationMailboxPath: "Target"
      },
      {
        accountId: account.id,
        messageId: "m-3",
        sourceFolderId: "acc:Source",
        sourceMailboxPath: "Source",
        sourceUid: 12,
        destinationFolderId: "acc:Target",
        destinationMailboxPath: "Target"
      }
    ]);

    await waitForMessageMoveJobsIdle(account.id);

    expect(moveImapMessages).toHaveBeenCalledTimes(1);
    expect(moveImapMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        id: account.id,
        email: account.email,
        imap: expect.objectContaining({
          host: account.imap.host,
          user: account.imap.user
        }),
        smtp: expect.objectContaining({
          host: account.smtp.host,
          user: account.smtp.user
        })
      }),
      "Source",
      [10, 11, 12],
      "Target",
      undefined
    );
    expect(updateMessageFolder).toHaveBeenCalledTimes(3);
    expect(updateMessageFolder).toHaveBeenNthCalledWith(
      1,
      account.id,
      "m-1",
      "acc:Target",
      "Target",
      110
    );
  });

  test("splits large batches into chunks of 200 messages", async () => {
    moveImapMessages.mockImplementation(async (_account, _source, uids) => {
      return new Map(uids.map((uid) => [uid, uid + 1000] as const));
    });

    enqueueMessageMoveJobs(
      Array.from({ length: 205 }, (_, index) => ({
        accountId: account.id,
        messageId: `m-${index + 1}`,
        sourceFolderId: "acc:Source",
        sourceMailboxPath: "Source",
        sourceUid: index + 1,
        destinationFolderId: "acc:Target",
        destinationMailboxPath: "Target"
      }))
    );

    await waitForMessageMoveJobsIdle(account.id);

    expect(moveImapMessages).toHaveBeenCalledTimes(2);
    expect(moveImapMessages.mock.calls[0]?.[2]).toHaveLength(200);
    expect(moveImapMessages.mock.calls[1]?.[2]).toHaveLength(5);
    expect(updateMessageFolder).toHaveBeenCalledTimes(205);
  });

  test("rolls back a failed batch to the source folder", async () => {
    moveImapMessages.mockRejectedValue(new Error("move failed"));

    enqueueMessageMoveJobs([
      {
        accountId: account.id,
        messageId: "m-1",
        sourceFolderId: "acc:Source",
        sourceMailboxPath: "Source",
        sourceUid: 20,
        destinationFolderId: "acc:Target",
        destinationMailboxPath: "Target"
      },
      {
        accountId: account.id,
        messageId: "m-2",
        sourceFolderId: "acc:Source",
        sourceMailboxPath: "Source",
        sourceUid: 21,
        destinationFolderId: "acc:Target",
        destinationMailboxPath: "Target"
      }
    ]);

    await waitForMessageMoveJobsIdle(account.id);

    expect(moveImapMessages).toHaveBeenCalledTimes(1);
    expect(updateMessageFolder).toHaveBeenCalledTimes(2);
    expect(updateMessageFolder).toHaveBeenNthCalledWith(
      1,
      account.id,
      "m-1",
      "acc:Source",
      "Source",
      20
    );
    expect(updateMessageFolder).toHaveBeenNthCalledWith(
      2,
      account.id,
      "m-2",
      "acc:Source",
      "Source",
      21
    );
  });
});
