/**
 * Write-side delete operations on the messages domain. Each function cleans
 * up the messages row, its attachment / FTS siblings, and the on-disk files
 * associated with those attachments; thread signals and topic learning state
 * for any affected threads are recomputed afterwards so that downstream
 * reads never observe a half-deleted thread.
 *
 * Every mutator runs inside `withDbWriteRetry` so that transient SQLite
 * BUSY/LOCKED errors do not surface as user-visible failures.
 */
import { withDbWriteRetry } from "../../dbWriteRetry";
import { deleteMessageFiles } from "../../storage";
import { getAccountDb } from "../connection";
import {
  pruneThreadTopicsWithoutMessages,
  rebuildThreadSignalsForThreadIds,
  recomputeThreadsForAccountInternal
} from "../threads";
import { upsertTopicLearningSignalsForThreadIds } from "../topics";
import { escapeLikePattern } from "./_shared";
import { listMessageFileRefsByMessageIds } from "./retrieval";

/**
 * Deletes a set of message rows together with the blobs backing their
 * attachments and sources. File removal runs first because, if any of the
 * DB writes fail, the orphaned rows can still be recovered from the IMAP
 * server whereas a stale on-disk blob would leak forever.
 */
export async function deleteMessagesWithFilesByIds(accountId: string, messageIds: string[]) {
  const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [] as string[];
  const fileRefs = await listMessageFileRefsByMessageIds(accountId, uniqueIds);
  await Promise.all(
    fileRefs.map((item) => deleteMessageFiles(accountId, item.messageId, item.attachmentIds))
  );
  await deleteMessagesByIds(accountId, uniqueIds);
  return uniqueIds;
}

/**
 * Resolves the message row for a (folderId, imapUid) pair and deletes it
 * with its files. Returns the canonical identifiers so callers (typically
 * IMAP sync) can emit precise deletion events without a second lookup.
 */
export async function deleteMessageByFolderUid(
  accountId: string,
  folderId: string,
  imapUid: number
) {
  const normalizedFolderId = folderId.trim();
  if (!normalizedFolderId || !Number.isFinite(imapUid)) {
    return null as { messageId: string; folderId: string; imapUid: number } | null;
  }
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(
      `SELECT id
       FROM messages
       WHERE accountId = ? AND folderId = ? AND imapUid = ?
       LIMIT 1`
    )
    .get(accountId, normalizedFolderId, imapUid) as { id?: string | null } | undefined;
  const messageId = row?.id?.trim();
  if (!messageId) return null;
  await deleteMessagesWithFilesByIds(accountId, [messageId]);
  return {
    messageId,
    folderId: normalizedFolderId,
    imapUid
  };
}

/**
 * Deletes a single message row (plus attachments + FTS) and repairs thread
 * signals / topic learning state if the message belonged to a thread. Does
 * not touch on-disk attachment files — callers needing that use
 * `deleteMessagesWithFilesByIds`.
 */
export async function deleteMessageById(accountId: string, messageId: string) {
  return withDbWriteRetry("deleteMessageById", async () => {
    const db = await getAccountDb(accountId);
    const row = db
      .prepare(`SELECT threadId FROM messages WHERE accountId = ? AND id = ?`)
      .get(accountId, messageId) as { threadId?: string | null } | undefined;
    db.transaction(() => {
      db.prepare(`DELETE FROM attachments WHERE messageId = ?`).run(messageId);
      db.prepare(`DELETE FROM message_fts WHERE messageId = ?`).run(messageId);
      db.prepare(`DELETE FROM messages WHERE accountId = ? AND id = ?`).run(accountId, messageId);
    })();
    if (row?.threadId) {
      await recomputeThreadsForAccountInternal(accountId, [row.threadId]);
      await rebuildThreadSignalsForThreadIds(db, accountId, [row.threadId]);
      upsertTopicLearningSignalsForThreadIds(db, accountId, [row.threadId]);
      pruneThreadTopicsWithoutMessages(db, accountId, [row.threadId]);
    }
  });
}

/**
 * Batch variant of `deleteMessageById`. Collects distinct affected
 * threadIds up front so thread recompute runs once over the full set
 * instead of once per message.
 */
export async function deleteMessagesByIds(accountId: string, messageIds: string[]) {
  const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return;
  return withDbWriteRetry("deleteMessagesByIds", async () => {
    const db = await getAccountDb(accountId);
    // Full-sync orphan cleanup can pass arrays larger than SQLite's
    // default 999-parameter limit. Chunk the IN (...) predicates at
    // the shared QUERY_BATCH_SIZE.
    const QUERY_BATCH_SIZE = 400;
    const threadIdSet = new Set<string>();
    for (let start = 0; start < uniqueIds.length; start += QUERY_BATCH_SIZE) {
      const chunk = uniqueIds.slice(start, start + QUERY_BATCH_SIZE);
      const placeholders = chunk.map(() => "?").join(",");
      const threadRows = db
        .prepare(
          `SELECT DISTINCT threadId
           FROM messages
           WHERE accountId = ? AND id IN (${placeholders}) AND threadId IS NOT NULL`
        )
        .all(accountId, ...chunk) as Array<{ threadId: string }>;
      threadRows.forEach((row) => {
        if (row.threadId) threadIdSet.add(row.threadId);
      });
    }
    const threadIds = Array.from(threadIdSet);
    db.transaction(() => {
      for (let start = 0; start < uniqueIds.length; start += QUERY_BATCH_SIZE) {
        const chunk = uniqueIds.slice(start, start + QUERY_BATCH_SIZE);
        const placeholders = chunk.map(() => "?").join(",");
        db.prepare(
          `DELETE FROM attachments
           WHERE messageId IN (
             SELECT id FROM messages
             WHERE accountId = ? AND id IN (${placeholders})
           )`
        ).run(accountId, ...chunk);
        db.prepare(
          `DELETE FROM message_fts
           WHERE messageId IN (
             SELECT id FROM messages
             WHERE accountId = ? AND id IN (${placeholders})
           )`
        ).run(accountId, ...chunk);
        db.prepare(`DELETE FROM messages WHERE accountId = ? AND id IN (${placeholders})`).run(
          accountId,
          ...chunk
        );
      }
    })();
    if (threadIds.length > 0) {
      await recomputeThreadsForAccountInternal(accountId, threadIds);
      await rebuildThreadSignalsForThreadIds(db, accountId, threadIds);
      upsertTopicLearningSignalsForThreadIds(db, accountId, threadIds);
      pruneThreadTopicsWithoutMessages(db, accountId, threadIds);
    }
  });
}

/**
 * Deletes every message stored under the given folder or any of its
 * descendants. Used when a folder subtree is renamed/removed on the
 * server and the caller wants to drop all local traces without
 * enumerating individual messages.
 *
 * Scoping is delimiter-aware: the predicate matches the folder itself
 * plus paths joined by the folder's delimiter. Without that guard, a
 * raw `folderId LIKE '${prefix}%'` would also match sibling folders
 * that merely share the prefix (deleting `Foo` would also match
 * `FooBar`). The delimiter is read from the `folders` row; falls back
 * to `/` if the row is missing. `escapeLikePattern` defuses `%` / `_`
 * / `\` in the folder name so names like `Archive_2024` can't match
 * unrelated folders via the single-char `_` wildcard.
 */
export async function deleteMessagesByFolderPrefix(accountId: string, folderPrefix: string) {
  return withDbWriteRetry("deleteMessagesByFolderPrefix", async () => {
    const db = await getAccountDb(accountId);
    const prefix = `${accountId}:${folderPrefix}`;
    const folderRow = db
      .prepare(
        `SELECT delimiter FROM folders WHERE accountId = ? AND id = ? LIMIT 1`
      )
      .get(accountId, prefix) as { delimiter?: string | null } | undefined;
    const delimiter = folderRow?.delimiter || "/";
    const childPattern = `${escapeLikePattern(prefix)}${escapeLikePattern(delimiter)}%`;
    const threadRows = db
      .prepare(
        `SELECT DISTINCT threadId
         FROM messages
         WHERE accountId = ?
           AND (folderId = ? OR folderId LIKE ? ESCAPE '\\')
           AND threadId IS NOT NULL`
      )
      .all(accountId, prefix, childPattern) as Array<{ threadId: string }>;
    if (threadRows.length === 0) {
      return;
    }
    const threadIds = threadRows.map((row) => row.threadId).filter(Boolean);
    db.transaction(() => {
      db.prepare(
        `DELETE FROM attachments
         WHERE messageId IN (
           SELECT id FROM messages
           WHERE accountId = ? AND (folderId = ? OR folderId LIKE ? ESCAPE '\\')
         )`
      ).run(accountId, prefix, childPattern);
      db.prepare(
        `DELETE FROM message_fts
         WHERE messageId IN (
           SELECT id FROM messages
           WHERE accountId = ? AND (folderId = ? OR folderId LIKE ? ESCAPE '\\')
         )`
      ).run(accountId, prefix, childPattern);
      db.prepare(
        `DELETE FROM messages
         WHERE accountId = ? AND (folderId = ? OR folderId LIKE ? ESCAPE '\\')`
      ).run(accountId, prefix, childPattern);
    })();
    if (threadIds.length > 0) {
      await recomputeThreadsForAccountInternal(accountId, threadIds);
      await rebuildThreadSignalsForThreadIds(db, accountId, threadIds);
      upsertTopicLearningSignalsForThreadIds(db, accountId, threadIds);
      pruneThreadTopicsWithoutMessages(db, accountId, threadIds);
    }
  });
}
