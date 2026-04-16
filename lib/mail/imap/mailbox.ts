// Mailbox-level IMAP reads: STATUS, UID listings, folder listing helpers.
//
// Public surface: getImapMailboxStatus, listImapMailboxUids,
// listImapMailboxUidsAndFlags + their snapshot types. The exported private
// helpers (listImapRaw, mapImapFolders, buildFolderSpecialUseByPath,
// resolveFolderSpecialUse, clientSupportsQresync) are consumed by sibling
// files (sync.ts, folders.ts) but NOT re-exported from the barrel.

import type { Account, Folder } from "@/lib/data";
import { logImapOp } from "@/lib/mail/imapLogger";
import type { ImapFlow } from "imapflow";
import {
  buildFolderId,
  buildLogContext,
  toFiniteNumber,
  type ImapLogContext
} from "./_shared";
import { withPooledImapClient } from "./connectionPool";

export function mapImapFolders(account: Account, list: Awaited<ReturnType<typeof listImapRaw>>) {
  return list.map((item) => {
    const delimiter = item.delimiter ?? "/";
    const pathParts = item.path.split(delimiter).filter(Boolean);
    const name = pathParts[pathParts.length - 1] ?? item.path;
    const parentPath = pathParts.slice(0, -1).join(delimiter);
    const parentId = parentPath ? buildFolderId(account.id, parentPath) : null;
    return {
      id: buildFolderId(account.id, item.path),
      name,
      count: 0,
      parentId,
      accountId: account.id,
      specialUse: item.specialUse ?? undefined,
      flags: item.flags ? Array.from(item.flags) : undefined,
      delimiter
    } as Folder;
  });
}

export function buildFolderSpecialUseByPath(
  list: Array<{ path?: string | null; specialUse?: string | null }>
) {
  const map = new Map<string, string>();
  list.forEach((item) => {
    const path = (item.path ?? "").trim().toLowerCase();
    if (!path) return;
    const specialUse = (item.specialUse ?? "").trim();
    if (!specialUse) return;
    map.set(path, specialUse);
  });
  return map;
}

export function resolveFolderSpecialUse(
  folderSpecialUseByPath: Map<string, string>,
  mailboxPath: string
) {
  return folderSpecialUseByPath.get(mailboxPath.trim().toLowerCase());
}

export async function listImapRaw(account: Account, logContext?: ImapLogContext) {
  return withPooledImapClient(account, logContext ?? buildLogContext(account), (client) =>
    logImapOp("list", { ...logContext }, () => client.list())
  );
}

export type ImapMailboxStatusSnapshot = {
  mailboxPath: string;
  uidNext: number | null;
  messages: number | null;
  unseen: number | null;
  uidValidity: string | null;
  highestModSeq: string | null;
};

export type ImapMailboxUidSnapshot = {
  mailboxPath: string;
  uidNext: number | null;
  uidValidity: string | null;
  highestModSeq: string | null;
  highestUid: number | null;
  supportsQresync: boolean;
  uids: number[];
  folders: Folder[];
};

export type ImapMailboxUidFlagSnapshot = {
  mailboxPath: string;
  uidNext: number | null;
  uidValidity: string | null;
  highestModSeq: string | null;
  highestUid: number | null;
  supportsQresync: boolean;
  entries: Array<{ uid: number; flags: string[] }>;
  folders: Folder[];
};

export async function getImapMailboxStatus(
  account: Account,
  mailboxPath: string,
  clientId?: string
): Promise<ImapMailboxStatusSnapshot> {
  const logContext = buildLogContext(account, clientId);
  return withPooledImapClient(account, logContext, async (client) => {
    const statusQuery: Record<string, boolean> = {
      uidNext: true,
      messages: true,
      unseen: true,
      uidValidity: true
    };
    if (clientSupportsQresync(client)) {
      statusQuery.highestModseq = true;
    }
    const status = await logImapOp(
      "status",
      { mailbox: mailboxPath, ...logContext },
      () => client.status(mailboxPath, statusQuery)
    );
    return {
      mailboxPath,
      uidNext: toFiniteNumber((status as { uidNext?: unknown })?.uidNext) ?? null,
      messages: toFiniteNumber((status as { messages?: unknown })?.messages) ?? null,
      unseen: toFiniteNumber((status as { unseen?: unknown })?.unseen) ?? null,
      uidValidity:
        (status as { uidValidity?: unknown })?.uidValidity == null
          ? null
          : String((status as { uidValidity?: unknown }).uidValidity),
      highestModSeq:
        (status as { highestModseq?: unknown })?.highestModseq == null
          ? null
          : String((status as { highestModseq?: unknown }).highestModseq),
    };
  });
}

export function clientSupportsQresync(client: ImapFlow) {
  const caps: any =
    (client as any).enabledCapabilities ||
    (client as any).serverCapabilities ||
    (client as any).capabilities ||
    null;
  if (!caps) return false;
  if (caps instanceof Set) return caps.has("QRESYNC") || caps.has("qresync");
  if (Array.isArray(caps)) return caps.includes("QRESYNC") || caps.includes("qresync");
  return false;
}

export async function listImapMailboxUids(
  account: Account,
  mailboxPath: string,
  clientId?: string
): Promise<ImapMailboxUidSnapshot> {
  const logContext = buildLogContext(account, clientId);
  return withPooledImapClient(account, logContext, async (client) => {
    const folderList = await logImapOp("list", { ...logContext }, () => client.list());
    const folders: Folder[] = mapImapFolders(account, folderList);
    const mailboxInfo = await logImapOp(
      "mailboxOpen",
      { mailbox: mailboxPath, readOnly: true, ...logContext },
      () => client.mailboxOpen(mailboxPath, { readOnly: true })
    );
    const messageCount = toFiniteNumber((mailboxInfo as { exists?: unknown })?.exists) ?? 0;
    const uids: number[] = [];
    if (messageCount > 0) {
      for await (const message of client.fetch("1:*", { uid: true })) {
        if (typeof message.uid === "number" && Number.isFinite(message.uid)) {
          uids.push(message.uid);
        }
      }
    }
    const highestUid = uids.length > 0 ? Math.max(...uids) : null;
    return {
      mailboxPath,
      uidNext: toFiniteNumber((mailboxInfo as { uidNext?: unknown })?.uidNext) ?? null,
      uidValidity:
        (mailboxInfo as { uidValidity?: unknown })?.uidValidity == null
          ? null
          : String((mailboxInfo as { uidValidity?: unknown }).uidValidity),
      highestModSeq:
        (mailboxInfo as { highestModseq?: unknown })?.highestModseq == null
          ? null
          : String((mailboxInfo as { highestModseq?: unknown }).highestModseq),
      highestUid,
      supportsQresync: clientSupportsQresync(client),
      uids,
      folders
    };
  });
}

/**
 * Lightweight IMAP fetch that retrieves only UIDs and flags for a mailbox.
 * Used by the two-phase sync approach: first fetch UIDs+flags to diff against
 * local state, then only download full source for genuinely new messages.
 */
export async function listImapMailboxUidsAndFlags(
  account: Account,
  mailboxPath: string,
  searchCriteria: string | Record<string, unknown>,
  clientId?: string
): Promise<ImapMailboxUidFlagSnapshot> {
  const logContext = buildLogContext(account, clientId);
  return withPooledImapClient(account, logContext, async (client) => {
    const folderList = await logImapOp("list", { ...logContext }, () => client.list());
    const folders: Folder[] = mapImapFolders(account, folderList);
    const mailboxInfo = await logImapOp(
      "mailboxOpen",
      { mailbox: mailboxPath, readOnly: true, ...logContext },
      () => client.mailboxOpen(mailboxPath, { readOnly: true })
    );
    const messageCount = toFiniteNumber((mailboxInfo as { exists?: unknown })?.exists) ?? 0;
    const entries: Array<{ uid: number; flags: string[] }> = [];
    if (messageCount > 0) {
      for await (const message of client.fetch(searchCriteria, { uid: true, flags: true })) {
        if (typeof message.uid === "number" && Number.isFinite(message.uid)) {
          entries.push({
            uid: message.uid,
            flags: message.flags ? Array.from(message.flags) : []
          });
        }
      }
    }
    // Derive highestUid from uidNext (authoritative) when available, falling
    // back to the max fetched UID. This is important for partial snapshots
    // (e.g. recent mode with a SINCE filter) where entries may be empty or
    // only cover a subset — using max(entries.uid) alone would regress the
    // watermark and break incremental sync planning.
    const uidNext = toFiniteNumber((mailboxInfo as { uidNext?: unknown })?.uidNext) ?? null;
    const maxEntryUid = entries.length > 0 ? Math.max(...entries.map((e) => e.uid)) : null;
    const highestUid =
      uidNext !== null && uidNext > 0
        ? Math.max(uidNext - 1, maxEntryUid ?? 0)
        : maxEntryUid;
    return {
      mailboxPath,
      uidNext,
      uidValidity:
        (mailboxInfo as { uidValidity?: unknown })?.uidValidity == null
          ? null
          : String((mailboxInfo as { uidValidity?: unknown }).uidValidity),
      highestModSeq:
        (mailboxInfo as { highestModseq?: unknown })?.highestModseq == null
          ? null
          : String((mailboxInfo as { highestModseq?: unknown }).highestModseq),
      highestUid,
      supportsQresync: clientSupportsQresync(client),
      entries,
      folders
    };
  });
}
