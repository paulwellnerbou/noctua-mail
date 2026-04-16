// IMAP folder CRUD: list, create, rename, delete, unsubscribe.
//
// Public surface: listImapFolders, createImapFolder, renameImapFolder,
// deleteImapFolder, unsubscribeImapFolder.

import type { Account } from "@/lib/data";
import { logImapOp } from "@/lib/mail/imapLogger";
import { safeLogoutImapClient } from "@/lib/mail/imapClientOptions";
import {
  buildLogContext,
  connectImapClient
} from "./_shared";
import { listImapRaw, mapImapFolders } from "./mailbox";

export async function listImapFolders(account: Account, clientId?: string) {
  const list = await listImapRaw(account, buildLogContext(account, clientId));
  return mapImapFolders(account, list);
}

export async function createImapFolder(account: Account, path: string, clientId?: string) {
  const logContext = buildLogContext(account, clientId);
  const client = await connectImapClient(account, logContext);
  try {
    await logImapOp("mailboxCreate", { mailbox: path, ...logContext }, () =>
      client.mailboxCreate(path)
    );
  } finally {
    await safeLogoutImapClient(client, { ...logContext });
  }
}

export async function renameImapFolder(
  account: Account,
  path: string,
  newPath: string,
  clientId?: string
) {
  const logContext = buildLogContext(account, clientId);
  const client = await connectImapClient(account, logContext);
  try {
    await logImapOp(
      "mailboxRename",
      { mailbox: path, newMailbox: newPath, ...logContext },
      () => client.mailboxRename(path, newPath)
    );
  } finally {
    await safeLogoutImapClient(client, { ...logContext });
  }
}

export async function deleteImapFolder(account: Account, path: string, clientId?: string) {
  const logContext = buildLogContext(account, clientId);
  const client = await connectImapClient(account, logContext);
  try {
    await logImapOp("mailboxDelete", { mailbox: path, ...logContext }, () =>
      client.mailboxDelete(path)
    );
  } finally {
    await safeLogoutImapClient(client, { ...logContext });
  }
}

export async function unsubscribeImapFolder(
  account: Account,
  path: string,
  clientId?: string
) {
  const logContext = buildLogContext(account, clientId);
  const client = await connectImapClient(account, logContext);
  try {
    await logImapOp("mailboxUnsubscribe", { mailbox: path, ...logContext }, () =>
      client.mailboxUnsubscribe(path)
    );
  } finally {
    await safeLogoutImapClient(client, { ...logContext });
  }
}
