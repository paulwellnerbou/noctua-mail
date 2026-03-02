import { afterAll, describe, expect, mock, test } from "bun:test";
import type { Account, Message } from "@/lib/data";

const getStoredMessagesByIds = mock(async () => []);
const relocateMovedMessage = mock(async () => null);
const findMissingStoredMailboxCopies = mock(async () => new Set<string>());
const actualDb = await import("./db");
const actualImap = await import("./mail/imap");

mock.module("@/lib/db", () => ({
  ...actualDb,
  getStoredMessagesByIds,
  relocateMovedMessage
}));

mock.module("@/lib/mail/imap", () => ({
  ...actualImap,
  findMissingStoredMailboxCopies
}));

afterAll(() => {
  mock.restore();
});

const { reconcileVerifiedCrossFolderMoves } = await import("./syncMoveReconciliation");

const account: Account = {
  id: "acc-1",
  name: "Test",
  email: "test@example.com",
  avatar: "",
  imap: {
    host: "imap.example.com",
    port: 993,
    secure: true,
    user: "test@example.com",
    password: "secret"
  },
  smtp: {
    host: "smtp.example.com",
    port: 465,
    secure: true,
    user: "test@example.com",
    password: "secret"
  }
};

const movedMessage: Message = {
  id: "imap-1",
  accountId: account.id,
  folderId: `${account.id}:INBOX/Archive`,
  mailboxPath: "INBOX/Archive",
  imapUid: 45,
  threadId: "<msg-1@example.com>",
  messageId: "<msg-1@example.com>",
  subject: "Moved message",
  from: "sender@example.com",
  to: "test@example.com",
  preview: "",
  date: "3/2/2026, 10:00:00 AM",
  dateValue: 1772445600000,
  body: ""
};

describe("reconcileVerifiedCrossFolderMoves", () => {
  test("relocates a stale local row when IMAP confirms the old UID is gone", async () => {
    getStoredMessagesByIds.mockReset();
    relocateMovedMessage.mockReset();
    findMissingStoredMailboxCopies.mockReset();

    getStoredMessagesByIds.mockResolvedValue([
      {
        id: movedMessage.id,
        messageId: movedMessage.messageId,
        folderId: `${account.id}:INBOX`,
        mailboxPath: "INBOX",
        imapUid: 75242
      }
    ]);
    findMissingStoredMailboxCopies.mockResolvedValue(new Set([movedMessage.id]));

    await reconcileVerifiedCrossFolderMoves(account, [movedMessage], "client-1");

    expect(findMissingStoredMailboxCopies).toHaveBeenCalledTimes(1);
    expect(relocateMovedMessage).toHaveBeenCalledTimes(1);
    expect(relocateMovedMessage).toHaveBeenCalledWith({
      accountId: account.id,
      previousId: movedMessage.id,
      destinationFolderId: movedMessage.folderId,
      destinationMailboxPath: movedMessage.mailboxPath,
      destinationUid: movedMessage.imapUid
    });
  });

  test("preserves a verified second copy in another folder", async () => {
    getStoredMessagesByIds.mockReset();
    relocateMovedMessage.mockReset();
    findMissingStoredMailboxCopies.mockReset();

    getStoredMessagesByIds.mockResolvedValue([
      {
        id: movedMessage.id,
        messageId: movedMessage.messageId,
        folderId: `${account.id}:INBOX`,
        mailboxPath: "INBOX",
        imapUid: 75242
      }
    ]);
    findMissingStoredMailboxCopies.mockResolvedValue(new Set());

    await reconcileVerifiedCrossFolderMoves(account, [movedMessage], "client-1");

    expect(findMissingStoredMailboxCopies).toHaveBeenCalledTimes(1);
    expect(relocateMovedMessage).not.toHaveBeenCalled();
  });
});
