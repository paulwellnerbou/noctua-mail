// IMAP message mutations: append, move, delete, flag updates.
//
// Public surface: appendImapMessage, moveImapMessage, moveImapMessages,
// deleteImapMessage, deleteImapMessages, updateImapFlags, updateImapFlagsBulk.
//
// All entry points run through `withPooledImapClient` so the IMAP connection
// can be reused across back-to-back mutations for the same account. See
// `connectionPool.ts` for the caching semantics.

import type { Account } from "@/lib/data";
import { logImapOp } from "@/lib/mail/imapLogger";
import { buildLogContext } from "./_shared";
import { withPooledImapClient } from "./connectionPool";

type MailboxUidTarget = { mailboxPath: string; uid: number };

function groupTargetsByMailbox(targets: MailboxUidTarget[]) {
  const grouped = new Map<string, Set<number>>();
  targets.forEach(({ mailboxPath, uid }) => {
    const path = mailboxPath.trim();
    if (!path) return;
    if (!Number.isFinite(uid) || uid <= 0) return;
    const existing = grouped.get(path);
    if (existing) {
      existing.add(uid);
      return;
    }
    grouped.set(path, new Set([uid]));
  });
  return Array.from(grouped.entries()).map(([mailboxPath, uidSet]) => ({
    mailboxPath,
    uids: Array.from(uidSet.values())
  }));
}

export async function appendImapMessage(
  account: Account,
  mailboxPath: string,
  rawMessage: Buffer,
  flags: string[] = ["\\Seen"],
  clientId?: string
) {
  const logContext = buildLogContext(account, clientId);
  return withPooledImapClient(account, logContext, async (client) => {
    const result = await logImapOp(
      "append",
      { mailbox: mailboxPath, ...logContext },
      () => client.append(mailboxPath, rawMessage, flags, new Date())
    );
    if (!result) return null;
    const uid = (result as any).uid;
    return typeof uid === "number" ? uid : null;
  });
}

export async function moveImapMessages(
  account: Account,
  mailboxPath: string,
  uids: number[],
  destination: string,
  clientId?: string
): Promise<Map<number, number | null>> {
  const normalizedUids = Array.from(
    new Set(uids.filter((uid) => Number.isFinite(uid) && uid > 0))
  );
  if (normalizedUids.length === 0) {
    return new Map<number, number | null>();
  }
  const logContext = buildLogContext(account, clientId);
  return withPooledImapClient(account, logContext, async (client) => {
    await logImapOp("mailboxOpen", { mailbox: mailboxPath, ...logContext }, () =>
      client.mailboxOpen(mailboxPath)
    );
    const result = await logImapOp(
      "messageMove",
      {
        mailbox: mailboxPath,
        uidCount: normalizedUids.length,
        uidSample: normalizedUids.slice(0, 20),
        destination,
        ...logContext
      },
      () => client.messageMove(normalizedUids, destination, { uid: true })
    );
    const destinationUidMap =
      result && typeof result === "object" && result.uidMap instanceof Map
        ? result.uidMap
        : null;
    return new Map(
      normalizedUids.map((uid) => {
        const destinationUid = destinationUidMap?.get(uid);
        return [uid, typeof destinationUid === "number" ? destinationUid : null] as const;
      })
    );
  });
}

export async function moveImapMessage(
  account: Account,
  mailboxPath: string,
  uid: number,
  destination: string,
  clientId?: string
): Promise<number | null> {
  const result = await moveImapMessages(account, mailboxPath, [uid], destination, clientId);
  return result.get(uid) ?? null;
}

type ImapDeleteTarget = MailboxUidTarget;

export async function deleteImapMessages(
  account: Account,
  targets: ImapDeleteTarget[],
  clientId?: string
) {
  const groupedTargets = groupTargetsByMailbox(targets);
  if (groupedTargets.length === 0) return;
  const logContext = buildLogContext(account, clientId);
  await withPooledImapClient(account, logContext, async (client) => {
    for (const target of groupedTargets) {
      await logImapOp("mailboxOpen", { mailbox: target.mailboxPath, ...logContext }, () =>
        client.mailboxOpen(target.mailboxPath)
      );
      await logImapOp(
        "messageDelete",
        { mailbox: target.mailboxPath, uidCount: target.uids.length, ...logContext },
        () => client.messageDelete(target.uids, { uid: true })
      );
    }
  });
}

export async function deleteImapMessage(
  account: Account,
  mailboxPath: string,
  uid: number,
  clientId?: string
) {
  await deleteImapMessages(account, [{ mailboxPath, uid }], clientId);
}

export async function updateImapFlags(
  account: Account,
  mailboxPath: string,
  uid: number,
  flag: string,
  enable: boolean,
  clientId?: string
) {
  await updateImapFlagsBulk(
    account,
    [{ mailboxPath, uid }],
    flag,
    enable,
    clientId
  );
}

export type ImapFlagTarget = MailboxUidTarget;

export async function updateImapFlagsBulk(
  account: Account,
  targets: ImapFlagTarget[],
  flag: string,
  enable: boolean,
  clientId?: string
) {
  if (targets.length === 0) return;
  const grouped = groupTargetsByMailbox(targets);
  // `targets` had entries but none survived validation (uid <= 0 / NaN, or
  // empty-trim mailbox path). Surface this loudly so callers don't silently
  // skip work and let local DB drift away from the IMAP server.
  if (grouped.length === 0) {
    throw new Error("Message is missing IMAP metadata");
  }
  const logContext = buildLogContext(account, clientId);
  await withPooledImapClient(account, logContext, async (client) => {
    for (const group of grouped) {
      await logImapOp("mailboxOpen", { mailbox: group.mailboxPath, ...logContext }, () =>
        client.mailboxOpen(group.mailboxPath)
      );
      const opLogContext = {
        mailbox: group.mailboxPath,
        uidCount: group.uids.length,
        uidSample: group.uids.slice(0, 20),
        flag,
        ...logContext
      };
      if (enable) {
        await logImapOp("flagsAdd", opLogContext, () =>
          client.messageFlagsAdd(group.uids, [flag], { uid: true })
        );
      } else {
        await logImapOp("flagsRemove", opLogContext, () =>
          client.messageFlagsRemove(group.uids, [flag], { uid: true })
        );
      }
    }
  });
}
