import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Account } from "@/lib/data";

const updateImapFlagsBulk = mock(async () => {});
const bulkUpdateMessageFlags = mock(async () => {});
const recomputeThreadsForAccount = mock(async () => {});

const actualServerImap = await import("./serverImap");
const actualServerDb = await import("./serverDb");

mock.module("./serverImap", () => ({
  ...actualServerImap,
  updateImapFlagsBulk
}));
mock.module("./serverDb", () => ({
  ...actualServerDb,
  bulkUpdateMessageFlags,
  recomputeThreadsForAccount
}));

const { applyFlagMutationsToMessages } = await import("./messageFlagMutation");

mock.restore();

const account: Account = {
  id: "acc-flag-mut",
  name: "Flag Mutations",
  email: "owner@example.test",
  avatar: "",
  imap: {
    host: "imap.example.test",
    port: 993,
    secure: true,
    user: "owner@example.test",
    password: "secret"
  },
  smtp: {
    host: "smtp.example.test",
    port: 465,
    secure: true,
    user: "owner@example.test",
    password: "secret"
  }
};

beforeEach(() => {
  updateImapFlagsBulk.mockReset();
  updateImapFlagsBulk.mockResolvedValue(undefined);
  bulkUpdateMessageFlags.mockReset();
  bulkUpdateMessageFlags.mockResolvedValue(undefined);
  recomputeThreadsForAccount.mockReset();
  recomputeThreadsForAccount.mockResolvedValue(undefined);
});

describe("applyFlagMutationsToMessages", () => {
  test("issues one IMAP STORE per mailbox group with that group's UIDs", async () => {
    await applyFlagMutationsToMessages({
      accountId: account.id,
      account,
      flag: "seen",
      value: true,
      targets: [
        { messageId: "m1", mailboxPath: "INBOX", imapUid: 101, flags: [], threadId: "t1" },
        { messageId: "m2", mailboxPath: "INBOX", imapUid: 102, flags: [], threadId: "t1" },
        { messageId: "m3", mailboxPath: "Archive", imapUid: 50, flags: [], threadId: "t2" }
      ]
    });

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
    await applyFlagMutationsToMessages({
      accountId: account.id,
      account,
      flag: "flagged",
      value: true,
      targets: [
        { messageId: "m1", mailboxPath: "INBOX", imapUid: 1, flags: [], threadId: "t-inbox" },
        { messageId: "m2", mailboxPath: "Archive", imapUid: 2, flags: [], threadId: "t-archive" }
      ]
    });

    expect(bulkUpdateMessageFlags).toHaveBeenCalledTimes(2);
    expect(recomputeThreadsForAccount).toHaveBeenCalledTimes(2);
    const recomputeArgs = recomputeThreadsForAccount.mock.calls.map((c) => c[1]);
    expect(recomputeArgs).toContainEqual(["t-inbox"]);
    expect(recomputeArgs).toContainEqual(["t-archive"]);
  });

  test("preserves earlier mailbox group's DB writes when a later group's IMAP STORE throws", async () => {
    const firstGroupTargets = [
      { messageId: "m1", mailboxPath: "INBOX", imapUid: 1, flags: [], threadId: "t-inbox" }
    ];
    const secondGroupTargets = [
      { messageId: "m2", mailboxPath: "Archive", imapUid: 2, flags: [], threadId: "t-archive" }
    ];
    let imapCalls = 0;
    updateImapFlagsBulk.mockImplementation(async () => {
      imapCalls += 1;
      if (imapCalls > 1) throw new Error("imap connection refused");
    });

    await expect(
      applyFlagMutationsToMessages({
        accountId: account.id,
        account,
        flag: "seen",
        value: true,
        targets: [...firstGroupTargets, ...secondGroupTargets]
      })
    ).rejects.toThrow("imap connection refused");

    // First group committed before the second's STORE failed.
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
      applyFlagMutationsToMessages({
        accountId: account.id,
        account,
        flag: "seen",
        value: true,
        targets: [
          { messageId: "m1", mailboxPath: "INBOX", imapUid: 1, flags: [], threadId: "t-inbox" }
        ]
      })
    ).rejects.toThrow("STORE rejected");

    expect(bulkUpdateMessageFlags).not.toHaveBeenCalled();
    expect(recomputeThreadsForAccount).not.toHaveBeenCalled();
  });

  test("rejects targets with missing IMAP metadata before any work", async () => {
    await expect(
      applyFlagMutationsToMessages({
        accountId: account.id,
        account,
        flag: "seen",
        value: true,
        targets: [
          { messageId: "m1", mailboxPath: "INBOX", imapUid: 1, flags: [] },
          { messageId: "m2", mailboxPath: "", imapUid: 2, flags: [] }
        ]
      })
    ).rejects.toThrow("Message is missing IMAP metadata");

    expect(updateImapFlagsBulk).not.toHaveBeenCalled();
    expect(bulkUpdateMessageFlags).not.toHaveBeenCalled();
  });

  test("issues two STOREs for `answered: true` (also sets \\Seen)", async () => {
    await applyFlagMutationsToMessages({
      accountId: account.id,
      account,
      flag: "answered",
      value: true,
      targets: [
        { messageId: "m1", mailboxPath: "INBOX", imapUid: 1, flags: [], threadId: "t" }
      ]
    });

    expect(updateImapFlagsBulk).toHaveBeenCalledTimes(2);
    const flags = updateImapFlagsBulk.mock.calls.map((c) => c[2]);
    expect(flags).toEqual(["\\Answered", "\\Seen"]);
    // Both IMAP STOREs succeeded before the DB commit.
    expect(bulkUpdateMessageFlags).toHaveBeenCalledTimes(1);
    expect(bulkUpdateMessageFlags.mock.calls[0]![1]).toEqual([
      { id: "m1", flags: ["\\Answered", "\\Seen"] }
    ]);
  });

  test("skips recompute when no target has a thread id", async () => {
    await applyFlagMutationsToMessages({
      accountId: account.id,
      account,
      flag: "seen",
      value: true,
      targets: [
        { messageId: "m1", mailboxPath: "INBOX", imapUid: 1, flags: [] }
      ]
    });

    expect(bulkUpdateMessageFlags).toHaveBeenCalledTimes(1);
    expect(recomputeThreadsForAccount).not.toHaveBeenCalled();
  });

  test("throws `Unknown flag` for an unrecognized flag key", async () => {
    await expect(
      applyFlagMutationsToMessages({
        accountId: account.id,
        account,
        flag: "bogus" as never,
        value: true,
        targets: [
          { messageId: "m1", mailboxPath: "INBOX", imapUid: 1, flags: [] }
        ]
      })
    ).rejects.toThrow("Unknown flag");

    expect(updateImapFlagsBulk).not.toHaveBeenCalled();
    expect(bulkUpdateMessageFlags).not.toHaveBeenCalled();
  });
});
