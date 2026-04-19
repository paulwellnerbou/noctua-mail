function normalizeThreadIds(threadIds?: Array<string | null | undefined>) {
  return Array.from(
    new Set((threadIds ?? []).map((threadId) => (threadId ?? "").trim()).filter(Boolean))
  );
}

function normalizeTopicIds(topicIds?: Array<string | null | undefined>) {
  return Array.from(
    new Set((topicIds ?? []).map((topicId) => (topicId ?? "").trim()).filter(Boolean))
  );
}

function buildTopicSignalExclusionKey(topicId: string, signalType: string, signalValue: string) {
  return `${topicId}\u0000${signalType}\u0000${signalValue}`;
}

function getTopicSignalExclusionSet(
  db: any,
  accountId: string,
  options?: {
    topicIds?: string[];
  }
) {
  const uniqueTopicIds = normalizeTopicIds(options?.topicIds);
  const rows = uniqueTopicIds.length > 0
    ? db
      .prepare(
        `SELECT topicId, signalType, signalValue
         FROM topic_signal_exclusions
         WHERE accountId = ?
           AND topicId IN (${uniqueTopicIds.map(() => "?").join(",")})`
      )
      .all(accountId, ...uniqueTopicIds)
    : db
      .prepare(
        `SELECT topicId, signalType, signalValue
         FROM topic_signal_exclusions
         WHERE accountId = ?`
      )
      .all(accountId);

  return new Set(
    (rows as Array<{
      topicId?: string | null;
      signalType?: string | null;
      signalValue?: string | null;
    }>)
      .map((row) => buildTopicSignalExclusionKey(
        (row.topicId ?? "").trim(),
        (row.signalType ?? "").trim(),
        (row.signalValue ?? "").trim()
      ))
      .filter((value) => value !== "\u0000\u0000")
  );
}

export function deleteTopicLearningSignals(
  db: any,
  accountId: string,
  options?: {
    threadIds?: string[];
    topicIds?: string[];
  }
) {
  const uniqueThreadIds = normalizeThreadIds(options?.threadIds);
  const uniqueTopicIds = normalizeTopicIds(options?.topicIds);
  if (uniqueThreadIds.length === 0 && uniqueTopicIds.length === 0) return;

  const clauses = [`accountId = ?`];
  const args: any[] = [accountId];
  if (uniqueThreadIds.length > 0) {
    clauses.push(`threadId IN (${uniqueThreadIds.map(() => "?").join(",")})`);
    args.push(...uniqueThreadIds);
  }
  if (uniqueTopicIds.length > 0) {
    clauses.push(`topicId IN (${uniqueTopicIds.map(() => "?").join(",")})`);
    args.push(...uniqueTopicIds);
  }

  db.prepare(
    `DELETE FROM topic_learning_signals
     WHERE ${clauses.join(" AND ")}`
  ).run(...args);
}

export function addTopicSignalExclusion(
  db: any,
  accountId: string,
  topicId: string,
  signalType: string,
  signalValue: string
) {
  db.prepare(
    `INSERT OR REPLACE INTO topic_signal_exclusions (
      accountId, topicId, signalType, signalValue, createdAt
    ) VALUES (?, ?, ?, ?, ?)`
  ).run(accountId, topicId, signalType, signalValue, Date.now());
}

export function clearTopicSignalExclusions(
  db: any,
  accountId: string,
  options?: {
    topicIds?: string[];
  }
) {
  const uniqueTopicIds = normalizeTopicIds(options?.topicIds);
  if (uniqueTopicIds.length === 0) {
    db.prepare(`DELETE FROM topic_signal_exclusions WHERE accountId = ?`).run(accountId);
    return;
  }

  db.prepare(
    `DELETE FROM topic_signal_exclusions
     WHERE accountId = ?
       AND topicId IN (${uniqueTopicIds.map(() => "?").join(",")})`
  ).run(accountId, ...uniqueTopicIds);
}

export function upsertTopicLearningSignalsForThreadIds(
  db: any,
  accountId: string,
  threadIds: string[],
  options?: {
    topicIds?: string[];
  }
) {
  const uniqueThreadIds = normalizeThreadIds(threadIds);
  if (uniqueThreadIds.length === 0) return;
  const uniqueTopicIds = normalizeTopicIds(options?.topicIds);
  const excludedSignals = getTopicSignalExclusionSet(db, accountId, {
    topicIds: uniqueTopicIds.length > 0 ? uniqueTopicIds : undefined
  });
  const insertLearningSignal = db.prepare(
    `INSERT OR IGNORE INTO topic_learning_signals (accountId, topicId, threadId, signalType, signalValue)
     VALUES (?, ?, ?, ?, ?)`
  );

  const selectBatchSize = 300;
  const topicClause =
    uniqueTopicIds.length > 0 ? `AND tt.topicId IN (${uniqueTopicIds.map(() => "?").join(",")})` : "";
  for (let start = 0; start < uniqueThreadIds.length; start += selectBatchSize) {
    const chunk = uniqueThreadIds.slice(start, start + selectBatchSize);
    const rows = db
      .prepare(
        `SELECT tt.topicId, ts.threadId, ts.signalType, ts.signalValue
         FROM thread_topics tt
         JOIN thread_signals ts ON ts.accountId = tt.accountId AND ts.threadId = tt.threadId
         WHERE tt.accountId = ?
           AND tt.threadId IN (${chunk.map(() => "?").join(",")})
           ${topicClause}`
      )
      .all(accountId, ...chunk, ...uniqueTopicIds) as Array<{
      topicId?: string | null;
      threadId?: string | null;
      signalType?: string | null;
      signalValue?: string | null;
    }>;

    rows.forEach((row) => {
      const topicId = (row.topicId ?? "").trim();
      const threadId = (row.threadId ?? "").trim();
      const signalType = (row.signalType ?? "").trim();
      const signalValue = (row.signalValue ?? "").trim();
      if (!topicId || !threadId || !signalType || !signalValue) return;
      if (excludedSignals.has(buildTopicSignalExclusionKey(topicId, signalType, signalValue))) {
        return;
      }
      insertLearningSignal.run(accountId, topicId, threadId, signalType, signalValue);
    });
  }
}

/**
 * @internal
 *
 * Called only by `lib/db/connection.ts#getAccountDb` via a deferred
 * dynamic import of this module (same load-time-cycle rationale as
 * `ensureThreadSignalRuntimeData`). Not re-exported from the `@/lib/db`
 * barrel; consumer code must not call this directly.
 */
export function ensureTopicLearningRuntimeData(db: any, accountId: string) {
  const hasTopicLearningSignals = db
    .prepare(`SELECT 1 FROM topic_learning_signals WHERE accountId = ? LIMIT 1`)
    .get(accountId);
  if (hasTopicLearningSignals) return;
  const threadRows = db
    .prepare(
      `SELECT DISTINCT threadId
       FROM thread_topics
       WHERE accountId = ?`
    )
    .all(accountId) as Array<{ threadId?: string | null }>;
  if (threadRows.length === 0) return;
  upsertTopicLearningSignalsForThreadIds(
    db,
    accountId,
    threadRows.map((row) => row.threadId ?? "")
  );
}
