import type { Folder, MailboxState } from "../data";
import { withDbWriteRetry } from "../dbWriteRetry";
import { getAccountDb, getDb } from "./connection";

function safeParseJson<T = unknown>(value: string | null | undefined, fallback?: T): T | undefined {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function listAccountIdsFromMaster() {
  const db = await getDb();
  const rows = db.prepare(`SELECT id FROM accounts ORDER BY id ASC`).all() as Array<{ id: string }>;
  return rows.map((row) => row.id).filter(Boolean);
}

async function getFoldersForAccount(accountId: string) {
  const db = await getAccountDb(accountId);
  const rows = db.prepare(`SELECT * FROM folders WHERE accountId = ?`).all(accountId) as any[];
  const messageCounts = db
    .prepare(
      `SELECT folderId,
              COUNT(*) as total,
              SUM(CASE WHEN unread = 1 THEN 1 ELSE 0 END) as unreadCount
       FROM messages
       WHERE accountId = ?
       GROUP BY folderId`
    )
    .all(accountId) as Array<{ folderId: string; total: number; unreadCount: number }>;
  const countMap = new Map<string, number>();
  const totalMap = new Map<string, number>();
  messageCounts.forEach((row) => {
    if (row.folderId) {
      totalMap.set(row.folderId, row.total ?? 0);
      countMap.set(row.folderId, row.unreadCount ?? 0);
    }
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId ?? undefined,
    accountId: row.accountId,
    count: totalMap.get(row.id) ?? row.count ?? 0,
    specialUse: row.specialUse ?? undefined,
    flags: safeParseJson<string[]>(row.flags),
    delimiter: row.delimiter ?? undefined,
    unreadCount: countMap.get(row.id) ?? 0
  })) as Folder[];
}

export async function getFolders(accountId?: string) {
  if (accountId) {
    return getFoldersForAccount(accountId);
  }
  const accountIds = await listAccountIdsFromMaster();
  const folderSets = await Promise.all(accountIds.map((id) => getFoldersForAccount(id)));
  return folderSets.flat();
}

export async function saveFoldersForAccount(accountId: string, nextFolders: Folder[]) {
  return withDbWriteRetry("saveFoldersForAccount", async () => {
    const db = await getAccountDb(accountId);
    const insert = db.prepare(
      `INSERT OR REPLACE INTO folders (id, name, parentId, accountId, count, specialUse, flags, delimiter) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const deleteForAccount = db.prepare(`DELETE FROM folders WHERE accountId = ?`);
    db.transaction(() => {
      deleteForAccount.run(accountId);
      nextFolders.forEach((folder) => {
        insert.run(
          folder.id,
          folder.name,
          folder.parentId ?? null,
          accountId,
          folder.count,
          folder.specialUse ?? null,
          folder.flags ? JSON.stringify(folder.flags) : null,
          folder.delimiter ?? null
        );
      });
    })();
  });
}

export async function getMailboxState(accountId: string, folderId: string) {
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(
      `SELECT accountId, folderId, mailboxPath, uidValidity, highestModSeq, highestUid, supportsQresync FROM mailbox_state WHERE accountId = ? AND folderId = ?`
    )
    .get(accountId, folderId) as
    | {
        accountId: string;
        folderId: string;
        mailboxPath: string;
        uidValidity: string | null;
        highestModSeq: string | null;
        highestUid: number | null;
        supportsQresync: number | null;
      }
    | undefined;
  if (!row) return null;
  return {
    accountId: row.accountId,
    folderId: row.folderId,
    mailboxPath: row.mailboxPath,
    uidValidity: row.uidValidity,
    highestModSeq: row.highestModSeq,
    highestUid: row.highestUid,
    supportsQresync: row.supportsQresync === null ? null : Boolean(row.supportsQresync)
  };
}

export async function saveMailboxState(state: MailboxState) {
  return withDbWriteRetry("saveMailboxState", async () => {
    const db = await getAccountDb(state.accountId);
    const insert = db.prepare(`
      INSERT OR REPLACE INTO mailbox_state
      (folderId, accountId, mailboxPath, uidValidity, highestModSeq, highestUid, supportsQresync)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      state.folderId,
      state.accountId,
      state.mailboxPath,
      state.uidValidity ?? null,
      state.highestModSeq ?? null,
      state.highestUid ?? null,
      state.supportsQresync == null ? null : state.supportsQresync ? 1 : 0
    );
  });
}

/**
 * Lightweight update of just the highestUid column in mailbox_state.
 * Used to persist sync progress after each batch so a killed worker can resume.
 * Only updates if the row already exists and the new UID is higher than the stored one.
 */
export async function updateMailboxHighestUid(
  accountId: string,
  folderId: string,
  highestUid: number
) {
  return withDbWriteRetry("updateMailboxHighestUid", async () => {
    const db = await getAccountDb(accountId);
    db.prepare(
      `UPDATE mailbox_state
       SET highestUid = ?
       WHERE accountId = ? AND folderId = ?
         AND (highestUid IS NULL OR highestUid < ?)`
    ).run(highestUid, accountId, folderId, highestUid);
  });
}
