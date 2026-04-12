import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account, Folder, Message } from "@/lib/data";
import { buildImapMessageRowId } from "./messageIds";
import { determineFolderConsistency } from "./syncPolicy";
import { dbModulePromise } from "./testDbHarness";

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Consistency copies",
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
}

function buildFolder(accountId: string, mailboxPath: string): Folder {
  return {
    id: `${accountId}:${mailboxPath}`,
    accountId,
    name: mailboxPath,
    count: 0,
    unreadCount: 0
  };
}

function buildMessage(params: {
  accountId: string;
  folderId: string;
  mailboxPath: string;
  imapUid: number;
  messageId: string;
}): Message {
  return {
    id: buildImapMessageRowId(params.messageId),
    accountId: params.accountId,
    folderId: params.folderId,
    mailboxPath: params.mailboxPath,
    imapUid: params.imapUid,
    threadId: params.messageId,
    messageId: params.messageId,
    subject: "Mailbox copy",
    from: "owner@example.test",
    to: "owner@example.test",
    preview: "Mailbox copy",
    date: new Date(Date.UTC(2026, 3, 12, 10, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 3, 12, 10, 0, 0),
    body: "Body",
    unread: true,
    seen: false
  };
}

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describe("folder consistency with same-folder Message-ID copies", () => {
  test("converges once the missing mailbox copy is stored as a separate row", async () => {
    const accountId = uniqueAccountId("acc-consistency-same-folder-copies");
    const mailboxPath = "INBOX";
    const folder = buildFolder(accountId, mailboxPath);
    const messageId = "<same-folder-consistency-copy@example.test>";
    const firstCopy = buildMessage({
      accountId,
      folderId: folder.id,
      mailboxPath,
      imapUid: 10,
      messageId
    });
    const secondCopy = buildMessage({
      accountId,
      folderId: folder.id,
      mailboxPath,
      imapUid: 11,
      messageId
    });
    const {
      getFolders,
      getLatestMessageUid,
      getMailboxState,
      saveFoldersForAccount,
      saveMailboxState,
      upsertAccount,
      upsertMessages
    } = await dbModulePromise;

    await upsertAccount(buildAccount(accountId));
    await saveFoldersForAccount(accountId, [folder]);
    await upsertMessages(accountId, folder.id, [firstCopy], true);
    await saveMailboxState({
      accountId,
      folderId: folder.id,
      mailboxPath,
      uidValidity: "1",
      highestModSeq: null,
      highestUid: 10,
      supportsQresync: false
    });

    const beforeFolders = await getFolders(accountId);
    const beforeState = await getMailboxState(accountId, folder.id);
    const beforeHighestUid = await getLatestMessageUid(accountId, mailboxPath);
    const before = determineFolderConsistency({
      remote: {
        count: 2,
        uidNext: 12,
        uidValidity: "1",
        highestModSeq: null
      },
      local: {
        count: beforeFolders.find((item) => item.id === folder.id)?.count ?? 0,
        highestUid: beforeHighestUid,
        uidValidity: beforeState?.uidValidity ?? null,
        highestModSeq: beforeState?.highestModSeq ?? null,
        supportsQresync: beforeState?.supportsQresync ?? false
      }
    });

    expect(before.needsRepair).toBe(true);
    expect(before.recommendedMode).toBe("repair");

    await upsertMessages(accountId, folder.id, [secondCopy], false);
    await saveMailboxState({
      accountId,
      folderId: folder.id,
      mailboxPath,
      uidValidity: "1",
      highestModSeq: null,
      highestUid: 11,
      supportsQresync: false
    });

    const afterFolders = await getFolders(accountId);
    const afterState = await getMailboxState(accountId, folder.id);
    const afterHighestUid = await getLatestMessageUid(accountId, mailboxPath);
    const after = determineFolderConsistency({
      remote: {
        count: 2,
        uidNext: 12,
        uidValidity: "1",
        highestModSeq: null
      },
      local: {
        count: afterFolders.find((item) => item.id === folder.id)?.count ?? 0,
        highestUid: afterHighestUid,
        uidValidity: afterState?.uidValidity ?? null,
        highestModSeq: afterState?.highestModSeq ?? null,
        supportsQresync: afterState?.supportsQresync ?? false
      }
    });

    expect(after).toEqual({
      needsRepair: false,
      recommendedMode: "none",
      reasons: []
    });
  });
});
