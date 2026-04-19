import { withDbWriteRetry } from "../dbWriteRetry";
import { collectThreadReferenceIds, resolveThreadingForItems } from "../threading";
import { collectTopicSignalEntries, type TopicSignalSource } from "../topicSignals";
import { getAccountDb } from "./connection";
import { getAccountEmail } from "./accounts";
import {
  deleteTopicLearningSignals,
  upsertTopicLearningSignalsForThreadIds
} from "./topics";

type ThreadSignalSourceRow = TopicSignalSource & {
  threadId?: string | null;
  toAddr?: string | null;
  ccAddr?: string | null;
};

function normalizeThreadIds(threadIds?: Array<string | null | undefined>) {
  return Array.from(
    new Set((threadIds ?? []).map((threadId) => (threadId ?? "").trim()).filter(Boolean))
  );
}

function insertThreadSignalsFromMessageRows(
  db: any,
  accountId: string,
  rows: ThreadSignalSourceRow[],
  options?: {
    accountEmail?: string | null;
  }
) {
  const insertThreadSignal = db.prepare(
    `INSERT OR REPLACE INTO thread_signals (accountId, threadId, signalType, signalValue)
     VALUES (?, ?, ?, ?)`
  );
  let activeThreadId = "";
  let activeRows: TopicSignalSource[] = [];
  const flush = () => {
    if (!activeThreadId || activeRows.length === 0) return;
    collectTopicSignalEntries(activeRows, {
      excludeAccountEmail: options?.accountEmail ?? null
    }).forEach((entry) => {
      insertThreadSignal.run(accountId, activeThreadId, entry.type, entry.value);
    });
  };

  rows.forEach((row) => {
    const threadId = (row.threadId ?? "").trim();
    if (!threadId) return;
    if (threadId !== activeThreadId) {
      flush();
      activeThreadId = threadId;
      activeRows = [];
    }
    activeRows.push({
      fromEmail: row.fromEmail,
      to: row.toAddr,
      cc: row.ccAddr,
      listId: row.listId,
      subject: row.subject,
      messageId: row.messageId
    });
  });
  flush();
}

function rebuildThreadSignalsForThreadIdsInternal(
  db: any,
  accountId: string,
  threadIds: string[],
  accountEmail?: string | null
) {
  const uniqueThreadIds = normalizeThreadIds(threadIds);
  if (uniqueThreadIds.length === 0) return;

  const deleteBatchSize = 400;
  for (let start = 0; start < uniqueThreadIds.length; start += deleteBatchSize) {
    const chunk = uniqueThreadIds.slice(start, start + deleteBatchSize);
    db.prepare(
      `DELETE FROM thread_signals
       WHERE accountId = ?
         AND threadId IN (${chunk.map(() => "?").join(",")})`
    ).run(accountId, ...chunk);
  }

  const selectedRows: ThreadSignalSourceRow[] = [];
  const selectBatchSize = 400;
  for (let start = 0; start < uniqueThreadIds.length; start += selectBatchSize) {
    const chunk = uniqueThreadIds.slice(start, start + selectBatchSize);
    const rows = db
      .prepare(
      `SELECT threadId, fromEmail, toAddr, ccAddr, listId, subject, messageId
         FROM messages
         WHERE accountId = ?
           AND threadId IN (${chunk.map(() => "?").join(",")})
         ORDER BY threadId ASC, dateValue ASC, id ASC`
      )
      .all(accountId, ...chunk) as ThreadSignalSourceRow[];
    selectedRows.push(...rows);
  }

  insertThreadSignalsFromMessageRows(db, accountId, selectedRows, { accountEmail });
}

export async function rebuildThreadSignalsForThreadIds(
  db: any,
  accountId: string,
  threadIds: string[]
) {
  const accountEmail = await getAccountEmail(accountId);
  rebuildThreadSignalsForThreadIdsInternal(db, accountId, threadIds, accountEmail);
}

function rebuildAllThreadSignalsForAccountInternal(
  db: any,
  accountId: string,
  accountEmail?: string | null
) {
  db.prepare(`DELETE FROM thread_signals WHERE accountId = ?`).run(accountId);
  const rows = db
    .prepare(
      `SELECT threadId, fromEmail, toAddr, ccAddr, listId, subject, messageId
       FROM messages
       WHERE accountId = ?
       ORDER BY threadId ASC, dateValue ASC, id ASC`
    )
    .all(accountId) as ThreadSignalSourceRow[];
  insertThreadSignalsFromMessageRows(db, accountId, rows, { accountEmail });
}

export async function rebuildAllThreadSignalsForAccount(db: any, accountId: string) {
  const accountEmail = await getAccountEmail(accountId);
  rebuildAllThreadSignalsForAccountInternal(db, accountId, accountEmail);
}

/**
 * @internal
 *
 * Called only by `lib/db/connection.ts#getAccountDb` via a deferred
 * dynamic import of this module, which breaks the load-time cycle with
 * `./accounts` (used for the account-email lookup inside
 * `rebuildAllThreadSignalsForAccount`). Not re-exported from the
 * `@/lib/db` barrel; consumer code must not call this directly.
 */
export async function ensureThreadSignalRuntimeData(db: any, accountId: string) {
  const hasThreadSignals = db
    .prepare(`SELECT 1 FROM thread_signals WHERE accountId = ? LIMIT 1`)
    .get(accountId);
  if (hasThreadSignals) return;
  const hasMessages = db
    .prepare(`SELECT 1 FROM messages WHERE accountId = ? LIMIT 1`)
    .get(accountId);
  if (!hasMessages) return;
  await rebuildAllThreadSignalsForAccount(db, accountId);
}

export function pruneThreadTopicsWithoutMessages(
  db: any,
  accountId: string,
  threadIds: string[]
) {
  const uniqueThreadIds = normalizeThreadIds(threadIds);
  if (uniqueThreadIds.length === 0) return;

  const deleteBatchSize = 400;
  for (let start = 0; start < uniqueThreadIds.length; start += deleteBatchSize) {
    const chunk = uniqueThreadIds.slice(start, start + deleteBatchSize);
    db.prepare(
      `DELETE FROM thread_topics
       WHERE accountId = ?
         AND threadId IN (${chunk.map(() => "?").join(",")})
         AND NOT EXISTS (
           SELECT 1
           FROM messages m
           WHERE m.accountId = thread_topics.accountId
             AND m.threadId = thread_topics.threadId
         )`
    ).run(accountId, ...chunk);
  }
}

/**
 * Builds the SQL fragment that computes a thread's latest received date while
 * skipping messages sent from the account's own email (so a reply the user
 * just sent does not bump the thread's "received" timestamp). When no account
 * email is available this falls back to plain MAX(dateValue). The caller must
 * pair this fragment with `getThreadLatestReceivedDateArgs(accountEmail)` to
 * bind the two placeholder occurrences.
 */
export function buildThreadLatestReceivedDateSql(messageAlias: string, accountEmail: string) {
  if (!accountEmail) {
    return `MAX(${messageAlias}.dateValue)`;
  }
  return `COALESCE(
    MAX(
      CASE
        WHEN lower(COALESCE(${messageAlias}.fromEmail, '')) = ?
          OR instr(lower(COALESCE(${messageAlias}.fromAddr, '')), ?) > 0
          THEN NULL
        ELSE ${messageAlias}.dateValue
      END
    ),
    MAX(${messageAlias}.dateValue)
  )`;
}

export function getThreadLatestReceivedDateArgs(accountEmail: string) {
  if (!accountEmail) return [];
  return [accountEmail, accountEmail];
}

/**
 * @internal
 *
 * Idempotent backfill for the `threads.latestReceivedDateValue` column.
 * Called from `lib/db/connection.ts#getAccountDb` alongside the other
 * runtime-data ensures so read queries (`listThreads`, etc.) never have
 * to trigger a write on their own path. Short-circuits with a single
 * `SELECT 1 ... WHERE latestReceivedDateValue IS NULL LIMIT 1` when
 * nothing needs updating. Accepts an optional `threadIds` scope for
 * targeted backfills after thread mutations.
 */
export async function ensureThreadLatestReceivedDateValues(
  db: any,
  accountId: string,
  threadIds?: string[]
) {
  const unique = normalizeThreadIds(threadIds);
  const hasMissingRows =
    unique.length > 0
      ? (db
          .prepare(
            `SELECT 1
             FROM threads
             WHERE accountId = ?
               AND threadId IN (${unique.map(() => "?").join(",")})
               AND latestReceivedDateValue IS NULL
             LIMIT 1`
          )
          .get(accountId, ...unique) as { 1?: number } | undefined)
      : (db
          .prepare(
            `SELECT 1
             FROM threads
             WHERE accountId = ? AND latestReceivedDateValue IS NULL
             LIMIT 1`
          )
          .get(accountId) as { 1?: number } | undefined);
  if (!hasMissingRows) return;

  const accountEmail = await getAccountEmail(accountId);
  const latestReceivedDateSql = buildThreadLatestReceivedDateSql("m", accountEmail);
  const latestReceivedDateArgs = getThreadLatestReceivedDateArgs(accountEmail);
  const threadFilterSql =
    unique.length > 0 ? `AND t.threadId IN (${unique.map(() => "?").join(",")})` : "";
  db.prepare(
    `
    UPDATE threads AS t
    SET latestReceivedDateValue = (
      SELECT ${latestReceivedDateSql}
      FROM messages m
      WHERE m.accountId = t.accountId
        AND m.threadId = t.threadId
    )
    WHERE t.accountId = ?
      ${threadFilterSql}
      AND t.latestReceivedDateValue IS NULL
  `
  ).run(...latestReceivedDateArgs, accountId, ...unique);
}

/**
 * @internal
 *
 * Recomputes `threads` rows without wrapping the work in `withDbWriteRetry`.
 * Callers that already hold a write-retry / transaction boundary (e.g. bulk
 * message mutations in `lib/db.ts`) use this to avoid nested retry scopes.
 * Not re-exported from the `@/lib/db` barrel.
 */
export async function recomputeThreadsForAccountInternal(accountId: string, threadIds?: string[]) {
  const db = await getAccountDb(accountId);
  const accountEmail = await getAccountEmail(accountId);
  const latestReceivedDateSql = buildThreadLatestReceivedDateSql("m", accountEmail);
  const latestReceivedDateArgs = getThreadLatestReceivedDateArgs(accountEmail);
  if (threadIds && threadIds.length > 0) {
    const unique = normalizeThreadIds(threadIds);
    if (unique.length === 0) return;
    const placeholders = unique.map(() => "?").join(", ");
    db.prepare(
      `DELETE FROM threads WHERE accountId = ? AND threadId IN (${placeholders})`
    ).run(accountId, ...unique);
    db.prepare(
      `
      INSERT OR REPLACE INTO threads (
        threadId,
        accountId,
        rootMessageId,
        latestMessageId,
        latestDateValue,
        latestReceivedDateValue,
        messageCount,
        unreadCount
      )
      SELECT
        m.threadId,
        m.accountId,
        MIN(m.id) FILTER (WHERE m.rn_asc = 1) as rootMessageId,
        MIN(m.id) FILTER (WHERE m.rn_desc = 1) as latestMessageId,
        MAX(m.dateValue) as latestDateValue,
        ${latestReceivedDateSql} as latestReceivedDateValue,
        COUNT(*) as messageCount,
        SUM(CASE WHEN m.unread = 1 THEN 1 ELSE 0 END) as unreadCount
      FROM (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY accountId, threadId ORDER BY dateValue ASC) as rn_asc,
          ROW_NUMBER() OVER (PARTITION BY accountId, threadId ORDER BY dateValue DESC) as rn_desc
        FROM messages
        WHERE accountId = ? AND threadId IN (${placeholders})
      ) m
      GROUP BY m.threadId, m.accountId
    `
    ).run(...latestReceivedDateArgs, accountId, ...unique);
    return;
  }
  db.prepare(`DELETE FROM threads WHERE accountId = ?`).run(accountId);
  db.prepare(
    `
    INSERT OR REPLACE INTO threads (
      threadId,
      accountId,
      rootMessageId,
      latestMessageId,
      latestDateValue,
      latestReceivedDateValue,
      messageCount,
      unreadCount
    )
    SELECT
      m.threadId,
      m.accountId,
      MIN(m.id) FILTER (WHERE m.rn_asc = 1) as rootMessageId,
      MIN(m.id) FILTER (WHERE m.rn_desc = 1) as latestMessageId,
      MAX(m.dateValue) as latestDateValue,
      ${latestReceivedDateSql} as latestReceivedDateValue,
      COUNT(*) as messageCount,
      SUM(CASE WHEN m.unread = 1 THEN 1 ELSE 0 END) as unreadCount
    FROM (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY accountId, threadId ORDER BY dateValue ASC) as rn_asc,
        ROW_NUMBER() OVER (PARTITION BY accountId, threadId ORDER BY dateValue DESC) as rn_desc
      FROM messages
      WHERE accountId = ?
    ) m
    GROUP BY m.threadId, m.accountId
  `
  ).run(...latestReceivedDateArgs, accountId);
}

export async function recomputeThreadsForAccount(accountId: string, threadIds?: string[]) {
  return withDbWriteRetry("recomputeThreadsForAccount", async () => {
    await recomputeThreadsForAccountInternal(accountId, threadIds);
    const db = await getAccountDb(accountId);
    if (threadIds && threadIds.length > 0) {
      await rebuildThreadSignalsForThreadIds(db, accountId, threadIds);
      deleteTopicLearningSignals(db, accountId, { threadIds });
      upsertTopicLearningSignalsForThreadIds(db, accountId, threadIds);
      return;
    }
    await rebuildAllThreadSignalsForAccount(db, accountId);
    db.prepare(`DELETE FROM topic_learning_signals WHERE accountId = ?`).run(accountId);
    const threadRows = db
      .prepare(
        `SELECT DISTINCT threadId
         FROM thread_topics
         WHERE accountId = ?`
      )
      .all(accountId) as Array<{ threadId?: string | null }>;
    upsertTopicLearningSignalsForThreadIds(
      db,
      accountId,
      threadRows.map((row) => row.threadId ?? "")
    );
  });
}

function parseReferencesForThreading(value?: string | null): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(String).filter(Boolean);
    }
  } catch {
    const parts = value.split(/\s+/).filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  }
  return undefined;
}

export async function recomputeThreadIdsForAccount(accountId: string) {
  return withDbWriteRetry("recomputeThreadIdsForAccount", async () => {
    const db = await getAccountDb(accountId);
    const rows = db
      .prepare(
        `SELECT id, messageId, inReplyTo, "references", threadId, parentId, dateValue
         FROM messages
         WHERE accountId = ?`
      )
      .all(accountId) as Array<{
      id: string;
      messageId: string | null;
      inReplyTo: string | null;
      references: string | null;
      threadId: string;
      parentId: string | null;
      dateValue: number;
    }>;
    if (rows.length === 0) return;
    const normalized = resolveThreadingForItems(
      rows.map((row) => ({
        id: row.id,
        dateValue: row.dateValue,
        messageId: row.messageId,
        inReplyTo: row.inReplyTo,
        references: parseReferencesForThreading(row.references),
        threadId: row.threadId
      }))
    );
    const normalizedById = new Map(normalized.map((row) => [row.id, row]));
    const updates: Array<{ id: string; threadId: string; parentId: string | null }> = [];
    rows.forEach((row) => {
      const next = normalizedById.get(row.id);
      if (!next?.threadId) return;
      const nextParentId = next.parentId ?? null;
      const nextThreadId = next.threadId;
      if (
        (nextThreadId && nextThreadId !== row.threadId) ||
        (nextParentId ?? null) !== (row.parentId ?? null)
      ) {
        updates.push({ id: row.id, threadId: nextThreadId, parentId: nextParentId });
      }
    });
    if (updates.length === 0) return;
    const update = db.prepare(`UPDATE messages SET threadId = ?, parentId = ? WHERE id = ?`);
    db.transaction(() => {
      updates.forEach((row) => update.run(row.threadId, row.parentId, row.id));
    })();
    await rebuildAllThreadSignalsForAccount(db, accountId);
  });
}

export async function getThreadIdsByMessageIds(accountId: string, messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, string>();
  const db = await getAccountDb(accountId);
  const requestedIds = Array.from(new Set(messageIds.map((value) => value.trim()).filter(Boolean)));
  if (requestedIds.length === 0) return new Map<string, string>();
  const rows = db
    .prepare(
      `SELECT messageId, threadId, dateValue, id
       FROM messages
       WHERE accountId = ?
         AND (
           messageId IN (${requestedIds.map(() => "?").join(",")})
           OR threadId IN (${requestedIds.map(() => "?").join(",")})
         )
       ORDER BY dateValue ASC, id ASC`
    )
    .all(accountId, ...requestedIds, ...requestedIds) as Array<{
    messageId: string | null;
    threadId: string | null;
    dateValue: number;
    id: string;
  }>;
  const map = new Map<string, string>();
  const requestedIdSet = new Set(requestedIds);
  rows.forEach((row) => {
    // The same Message-ID may appear in multiple folders. Use the oldest copy
    // as the canonical external thread mapping to keep sync-time threading stable.
    if (
      row.messageId &&
      row.threadId &&
      requestedIdSet.has(row.messageId) &&
      !map.has(row.messageId)
    ) {
      map.set(row.messageId, row.threadId);
    }
    if (
      row.threadId &&
      requestedIdSet.has(row.threadId) &&
      !map.has(row.threadId)
    ) {
      map.set(row.threadId, row.threadId);
    }
  });
  return map;
}

export async function getMessageIdsByMessageIds(accountId: string, messageIds: string[]) {
  if (messageIds.length === 0) return new Map<string, string>();
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT messageId, id, dateValue
       FROM messages
       WHERE accountId = ? AND messageId IN (${messageIds.map(() => "?").join(",")})
       ORDER BY dateValue ASC`
    )
    .all(accountId, ...messageIds) as Array<{
    messageId: string | null;
    id: string;
    dateValue: number;
  }>;
  const map = new Map<string, string>();
  rows.forEach((row) => {
    if (row.messageId && row.id && !map.has(row.messageId)) {
      map.set(row.messageId, row.id);
    }
  });
  return map;
}

type ThreadingResolvableItem = {
  id: string;
  dateValue: number;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: readonly string[] | null;
  threadId?: string | null;
};

export async function resolveThreadingForAccountMessages<T extends ThreadingResolvableItem>(
  accountId: string,
  messages: readonly T[]
) {
  if (messages.length === 0) {
    return [] as Array<T & { threadId: string; parentId?: string }>;
  }

  const referenceIds = collectThreadReferenceIds(messages);
  const [externalThreadIds, externalParentIds] = await Promise.all([
    referenceIds.length > 0
      ? getThreadIdsByMessageIds(accountId, referenceIds)
      : Promise.resolve(new Map<string, string>()),
    referenceIds.length > 0
      ? getMessageIdsByMessageIds(accountId, referenceIds)
      : Promise.resolve(new Map<string, string>())
  ]);

  return resolveThreadingForItems(messages, {
    externalThreadIds,
    externalParentIds
  });
}

export async function getThreadMessageIdsForMove(params: {
  accountId: string;
  threadId: string;
  sourceFolderId?: string | null;
  excludedFolderIds?: string[];
}) {
  const { accountId, threadId, sourceFolderId, excludedFolderIds = [] } = params;
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) return [] as string[];
  const uniqueExcludedFolderIds = Array.from(
    new Set(excludedFolderIds.map((folderId) => folderId.trim()).filter(Boolean))
  );
  const db = await getAccountDb(accountId);
  const clauses = [
    "accountId = ?",
    "threadId = ?",
    "COALESCE(deleted, 0) = 0"
  ];
  const args: Array<string> = [accountId, normalizedThreadId];
  if (sourceFolderId?.trim()) {
    clauses.push("folderId = ?");
    args.push(sourceFolderId.trim());
  }
  if (uniqueExcludedFolderIds.length > 0) {
    clauses.push(`folderId NOT IN (${uniqueExcludedFolderIds.map(() => "?").join(",")})`);
    args.push(...uniqueExcludedFolderIds);
  }
  const rows = db
    .prepare(
      `SELECT id
       FROM messages
       WHERE ${clauses.join(" AND ")}
       ORDER BY dateValue ASC, id ASC`
    )
    .all(...args) as Array<{ id?: string | null }>;
  return rows
    .map((row) => String(row.id ?? "").trim())
    .filter(Boolean);
}
