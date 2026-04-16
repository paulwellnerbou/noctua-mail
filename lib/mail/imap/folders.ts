// IMAP folder CRUD: list, create, rename, delete, unsubscribe.
//
// Public surface: listImapFolders, createImapFolder, renameImapFolder,
// deleteImapFolder, unsubscribeImapFolder.
//
// All CRUD entry points run through `withPooledImapClient` so back-to-back
// folder operations (e.g. create + rename + delete) for the same account
// can reuse a single authenticated connection.

import type { Account } from "@/lib/data";
import { logImapOp } from "@/lib/mail/imapLogger";
import { buildLogContext } from "./_shared";
import { withPooledImapClient } from "./connectionPool";
import { listImapRaw, mapImapFolders } from "./mailbox";

export async function listImapFolders(account: Account, clientId?: string) {
  const list = await listImapRaw(account, buildLogContext(account, clientId));
  return mapImapFolders(account, list);
}

export async function createImapFolder(account: Account, path: string, clientId?: string) {
  const logContext = buildLogContext(account, clientId);
  await withPooledImapClient(account, logContext, async (client) => {
    await logImapOp("mailboxCreate", { mailbox: path, ...logContext }, () =>
      client.mailboxCreate(path)
    );
  });
}

export async function renameImapFolder(
  account: Account,
  path: string,
  newPath: string,
  clientId?: string
) {
  const logContext = buildLogContext(account, clientId);
  await withPooledImapClient(account, logContext, async (client) => {
    await logImapOp(
      "mailboxRename",
      { mailbox: path, newMailbox: newPath, ...logContext },
      () => client.mailboxRename(path, newPath)
    );
  });
}

export async function deleteImapFolder(account: Account, path: string, clientId?: string) {
  const logContext = buildLogContext(account, clientId);
  await withPooledImapClient(account, logContext, async (client) => {
    await logImapOp("mailboxDelete", { mailbox: path, ...logContext }, () =>
      client.mailboxDelete(path)
    );
  });
}

export async function unsubscribeImapFolder(
  account: Account,
  path: string,
  clientId?: string
) {
  const logContext = buildLogContext(account, clientId);
  await withPooledImapClient(account, logContext, async (client) => {
    await logImapOp("mailboxUnsubscribe", { mailbox: path, ...logContext }, () =>
      client.mailboxUnsubscribe(path)
    );
  });
}
