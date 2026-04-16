// IMAP message mutations: append, move, delete, flag updates.
//
// Public surface: appendImapMessage, moveImapMessage, moveImapMessages,
// deleteImapMessage, deleteImapMessages, updateImapFlags.

import type { Account } from "@/lib/data";
import { logImapOp } from "@/lib/mail/imapLogger";
import { safeLogoutImapClient } from "@/lib/mail/imapClientOptions";
import {
  buildLogContext,
  connectImapClient
} from "./_shared";

export async function appendImapMessage(
  account: Account,
  mailboxPath: string,
  rawMessage: Buffer,
  flags: string[] = ["\\Seen"],
  clientId?: string
) {
  const logContext = buildLogContext(account, clientId);
  const client = await connectImapClient(account, logContext);

  try {
    const result = await logImapOp(
      "append",
      { mailbox: mailboxPath, ...logContext },
      () => client.append(mailboxPath, rawMessage, flags, new Date())
    );
    if (!result) return null;
    const uid = (result as any).uid;
    return typeof uid === "number" ? uid : null;
  } finally {
    await safeLogoutImapClient(client, { ...logContext });
  }
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
  const client = await connectImapClient(account, logContext);

  try {
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
  } finally {
    await safeLogoutImapClient(client, { ...logContext });
  }
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

type ImapDeleteTarget = {
  mailboxPath: string;
  uid: number;
};

function groupDeleteTargetsByMailbox(targets: ImapDeleteTarget[]) {
  const grouped = new Map<string, Set<number>>();
  targets.forEach((target) => {
    const mailboxPath = target.mailboxPath.trim();
    const uid = target.uid;
    if (!mailboxPath) return;
    if (!Number.isFinite(uid) || uid <= 0) return;
    const existing = grouped.get(mailboxPath);
    if (existing) {
      existing.add(uid);
      return;
    }
    grouped.set(mailboxPath, new Set([uid]));
  });
  return Array.from(grouped.entries()).map(([mailboxPath, uidSet]) => ({
    mailboxPath,
    uids: Array.from(uidSet.values())
  }));
}

export async function deleteImapMessages(
  account: Account,
  targets: ImapDeleteTarget[],
  clientId?: string
) {
  const groupedTargets = groupDeleteTargetsByMailbox(targets);
  if (groupedTargets.length === 0) return;
  const logContext = buildLogContext(account, clientId);
  const client = await connectImapClient(account, logContext);

  try {
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
  } finally {
    await safeLogoutImapClient(client, { ...logContext });
  }
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
  const logContext = buildLogContext(account, clientId);
  const client = await connectImapClient(account, logContext);

  try {
    await logImapOp("mailboxOpen", { mailbox: mailboxPath, ...logContext }, () =>
      client.mailboxOpen(mailboxPath)
    );
    if (enable) {
      await logImapOp("flagsAdd", { mailbox: mailboxPath, uid, flag, ...logContext }, () =>
        client.messageFlagsAdd(uid, [flag], { uid: true })
      );
    } else {
      await logImapOp(
        "flagsRemove",
        { mailbox: mailboxPath, uid, flag, ...logContext },
        () => client.messageFlagsRemove(uid, [flag], { uid: true })
      );
    }
  } finally {
    await safeLogoutImapClient(client, { ...logContext });
  }
}
