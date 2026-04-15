import { randomUUID } from "crypto";
import {
  addTopicSignalExclusion,
  clearTopicSignalExclusions,
  deleteTopicLearningSignals,
  upsertTopicLearningSignalsForThreadIds,
  withAccountDb
} from "../db";
import type { Topic, TopicColor, TopicSuggestionSignal } from "../data";
import { TOPIC_SUGGESTION_SIGNALS } from "../data";

export type TopicSignalStat = { type: TopicSuggestionSignal; value: string; count: number };
export type TopicStat = {
  topicId: string;
  threadCount: number;
  messageCount: number;
  topSignals: TopicSignalStat[];
};

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function buildImapKeyword(id: string): string {
  // IMAP keywords must be printable ASCII ATOM chars (RFC 3501).
  // Using the topic ID gives a stable, unique, readable-enough keyword.
  return `noctua-topic-${id}`;
}

export function normalizeTopicShortName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

export function rememberTopicLearningForThread(
  db: any,
  accountId: string,
  threadId: string,
  topicIds?: string[]
) {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) return;
  upsertTopicLearningSignalsForThreadIds(db, accountId, [normalizedThreadId], {
    topicIds
  });
}

// Future: IMAP keyword sync
// Topics are stored locally per-thread, but IMAP keywords are per-message.
// When syncing a topic assignment to IMAP, fan out the keyword write to every
// message belonging to the thread. Group by mailbox and open each mailbox only
// once per sync call, using messageFlagsAdd/Remove with a UID array to minimise
// round-trips. This should be fire-and-forget (best-effort): a failure must not
// roll back the local DB write. On inbound sync, detect `noctua-topic-*` keywords
// on arriving messages and import them back into thread_topics.

export function rowToTopic(row: any): Topic {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    shortName: normalizeTopicShortName(row.shortName),
    color: (row.color || null) as TopicColor | null,
    imapKeyword: row.imapKeyword,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export async function listTopics(accountId: string): Promise<Topic[]> {
  return withAccountDb(accountId, (db) => {
    const rows = db
      .prepare(`SELECT * FROM topics WHERE accountId = ? ORDER BY name ASC`)
      .all(accountId) as any[];
    return rows.map(rowToTopic);
  });
}

export async function getTopicById(accountId: string, topicId: string): Promise<Topic | null> {
  return withAccountDb(accountId, (db) => {
    const row = db
      .prepare(`SELECT * FROM topics WHERE id = ? AND accountId = ?`)
      .get(topicId, accountId) as any | undefined;
    return row ? rowToTopic(row) : null;
  });
}

export async function createTopic(
  accountId: string,
  name: string,
  color: TopicColor | null,
  shortName?: string | null
): Promise<Topic> {
  const id = slugify(name) + "-" + randomUUID().slice(0, 8);
  const imapKeyword = buildImapKeyword(id);
  const now = Date.now();
  const normalizedShortName = normalizeTopicShortName(shortName);
  const topic: Topic = {
    id,
    accountId,
    name,
    shortName: normalizedShortName,
    color: color ?? null,
    imapKeyword,
    createdAt: now,
    updatedAt: now
  };

  await withAccountDb(accountId, (db) => {
    db.prepare(
      `INSERT INTO topics (id, accountId, name, shortName, color, imapKeyword, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, accountId, name, normalizedShortName, color ?? "", imapKeyword, now, now);
  });

  return topic;
}

export async function updateTopic(
  accountId: string,
  topicId: string,
  changes: { name?: string; shortName?: string | null; color?: TopicColor | null }
): Promise<Topic | null> {
  return withAccountDb(accountId, (db) => {
    const now = Date.now();
    const sets: string[] = ["updatedAt = ?"];
    const values: any[] = [now];
    if (changes.name !== undefined) {
      sets.push("name = ?");
      values.push(changes.name);
    }
    if (changes.shortName !== undefined) {
      sets.push("shortName = ?");
      values.push(normalizeTopicShortName(changes.shortName));
    }
    if (changes.color !== undefined) {
      sets.push("color = ?");
      values.push(changes.color ?? "");
    }
    values.push(topicId, accountId);
    db.prepare(
      `UPDATE topics SET ${sets.join(", ")} WHERE id = ? AND accountId = ?`
    ).run(...values);
    const row = db
      .prepare(`SELECT * FROM topics WHERE id = ? AND accountId = ?`)
      .get(topicId, accountId) as any | undefined;
    return row ? rowToTopic(row) : null;
  });
}

export async function deleteTopic(accountId: string, topicId: string): Promise<boolean> {
  return withAccountDb(accountId, (db) => {
    deleteTopicLearningSignals(db, accountId, { topicIds: [topicId] });
    clearTopicSignalExclusions(db, accountId, { topicIds: [topicId] });
    db.prepare(`DELETE FROM thread_topics WHERE topicId = ? AND accountId = ?`).run(
      topicId,
      accountId
    );
    const result = db
      .prepare(`DELETE FROM topics WHERE id = ? AND accountId = ?`)
      .run(topicId, accountId) as { changes: number };
    return result.changes > 0;
  });
}

export async function getTopicsForThread(accountId: string, threadId: string): Promise<Topic[]> {
  return withAccountDb(accountId, (db) => {
    const rows = db
      .prepare(
        `SELECT t.* FROM topics t
         JOIN thread_topics tt ON t.id = tt.topicId
         WHERE tt.threadId = ? AND tt.accountId = ?
         ORDER BY t.name ASC`
      )
      .all(threadId, accountId) as any[];
    return rows.map(rowToTopic);
  });
}

export async function getTopicsForThreads(
  accountId: string,
  threadIds: string[]
): Promise<Map<string, Topic[]>> {
  if (threadIds.length === 0) return new Map();
  return withAccountDb(accountId, (db) => {
    const placeholders = threadIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT tt.threadId, t.* FROM topics t
         JOIN thread_topics tt ON t.id = tt.topicId
         WHERE tt.threadId IN (${placeholders}) AND tt.accountId = ?
         ORDER BY t.name ASC`
      )
      .all(...threadIds, accountId) as any[];

    const result = new Map<string, Topic[]>();
    for (const row of rows) {
      const list = result.get(row.threadId) ?? [];
      list.push(rowToTopic(row));
      result.set(row.threadId, list);
    }
    return result;
  });
}

export async function setThreadTopics(
  accountId: string,
  threadId: string,
  topicIds: string[]
): Promise<Topic[]> {
  return withAccountDb(accountId, (db) => {
    const now = Date.now();
    const normalizedThreadId = threadId.trim();
    const nextTopicIds = Array.from(new Set(topicIds.map((topicId) => topicId.trim()).filter(Boolean)));
    const previousTopicIds = (db
      .prepare(
        `SELECT topicId
         FROM thread_topics
         WHERE accountId = ? AND threadId = ?`
      )
      .all(accountId, normalizedThreadId) as Array<{ topicId?: string | null }>)
      .map((row) => (row.topicId ?? "").trim())
      .filter(Boolean);
    const removedTopicIds = previousTopicIds.filter((topicId) => !nextTopicIds.includes(topicId));
    if (removedTopicIds.length > 0) {
      deleteTopicLearningSignals(db, accountId, {
        threadIds: [normalizedThreadId],
        topicIds: removedTopicIds
      });
    }
    db.prepare(`DELETE FROM thread_topics WHERE threadId = ? AND accountId = ?`).run(
      normalizedThreadId,
      accountId
    );
    for (const topicId of nextTopicIds) {
      db.prepare(
        `INSERT OR IGNORE INTO thread_topics (threadId, topicId, accountId, assignedAt)
         VALUES (?, ?, ?, ?)`
      ).run(normalizedThreadId, topicId, accountId, now);
    }
    rememberTopicLearningForThread(db, accountId, normalizedThreadId, nextTopicIds);
    const rows = db
      .prepare(
        `SELECT t.* FROM topics t
         JOIN thread_topics tt ON t.id = tt.topicId
         WHERE tt.threadId = ? AND tt.accountId = ?
         ORDER BY t.name ASC`
      )
      .all(normalizedThreadId, accountId) as any[];
    return rows.map(rowToTopic);
  });
}

export async function addThreadTopic(
  accountId: string,
  threadId: string,
  topicId: string
): Promise<void> {
  await withAccountDb(accountId, (db) => {
    const normalizedThreadId = threadId.trim();
    const normalizedTopicId = topicId.trim();
    db.prepare(
      `INSERT OR IGNORE INTO thread_topics (threadId, topicId, accountId, assignedAt)
       VALUES (?, ?, ?, ?)`
    ).run(normalizedThreadId, normalizedTopicId, accountId, Date.now());
    rememberTopicLearningForThread(db, accountId, normalizedThreadId, [normalizedTopicId]);
  });
}

export async function removeThreadTopic(
  accountId: string,
  threadId: string,
  topicId: string
): Promise<void> {
  await withAccountDb(accountId, (db) => {
    const normalizedThreadId = threadId.trim();
    const normalizedTopicId = topicId.trim();
    deleteTopicLearningSignals(db, accountId, {
      threadIds: [normalizedThreadId],
      topicIds: [normalizedTopicId]
    });
    db.prepare(
      `DELETE FROM thread_topics WHERE threadId = ? AND topicId = ? AND accountId = ?`
    ).run(normalizedThreadId, normalizedTopicId, accountId);
  });
}

export async function excludeTopicLearningSignal(
  accountId: string,
  topicId: string,
  signalType: TopicSuggestionSignal,
  signalValue: string
): Promise<boolean> {
  return withAccountDb(accountId, (db) => {
    const normalizedTopicId = topicId.trim();
    const normalizedSignalValue = signalValue.trim();
    if (!normalizedTopicId || !normalizedSignalValue) return false;

    const topicExists = db
      .prepare(
        `SELECT 1
         FROM topics
         WHERE accountId = ? AND id = ?
         LIMIT 1`
      )
      .get(accountId, normalizedTopicId);
    if (!topicExists) return false;

    addTopicSignalExclusion(db, accountId, normalizedTopicId, signalType, normalizedSignalValue);
    db.prepare(
      `DELETE FROM topic_learning_signals
       WHERE accountId = ?
         AND topicId = ?
         AND signalType = ?
         AND signalValue = ?`
    ).run(accountId, normalizedTopicId, signalType, normalizedSignalValue);

    return true;
  });
}

/**
 * Return per-topic learning statistics: message/thread counts and top signal values.
 * Used to visualize how much the system has learned about each topic.
 */
export async function getTopicStats(
  accountId: string,
  options?: {
    accountEmail?: string | null;
  }
): Promise<TopicStat[]> {
  const accountEmail = options?.accountEmail?.toLowerCase().trim() || null;
  return withAccountDb(accountId, (db) => {
    const threadCounts = db
      .prepare(
        `SELECT topicId, COUNT(DISTINCT threadId) AS threadCount
         FROM topic_learning_signals
         WHERE accountId = ?
         GROUP BY topicId`
      )
      .all(accountId) as Array<{ topicId: string; threadCount: number }>;

    if (threadCounts.length === 0) return [];

    const messageCountByTopic = new Map(
      (db
      .prepare(
        `SELECT tt.topicId,
                COUNT(m.id) AS messageCount
         FROM thread_topics tt
         JOIN messages m
           ON m.accountId = tt.accountId
          AND m.threadId = tt.threadId
         WHERE tt.accountId = ?
         GROUP BY tt.topicId`
      )
      .all(accountId) as Array<{ topicId: string; messageCount: number }>)
        .map((row) => [row.topicId, row.messageCount] as const)
    );

    const rows = db
      .prepare(
        `SELECT tls.topicId,
                tls.signalType,
                tls.signalValue,
                COUNT(DISTINCT tls.threadId) AS cnt
         FROM topic_learning_signals tls
         WHERE tls.accountId = ?
           AND (
             tls.signalType != 'recipient'
             OR lower(tls.signalValue) != lower(COALESCE(?, ''))
           )
         GROUP BY tls.topicId, tls.signalType, tls.signalValue`
      )
      .all(accountId, accountEmail) as Array<{
      topicId: string;
      signalType?: string | null;
      signalValue?: string | null;
      cnt: number;
    }>;

    const signalTypeOrder = new Map<TopicSuggestionSignal, number>(
      TOPIC_SUGGESTION_SIGNALS.map((type, idx) => [type, idx])
    );
    const countsByTopic = new Map<string, Map<string, TopicSignalStat>>();

    rows.forEach((row) => {
      const type = (row.signalType ?? "").trim() as TopicSuggestionSignal;
      const value = (row.signalValue ?? "").trim();
      if (!TOPIC_SUGGESTION_SIGNALS.includes(type) || !value) return;
      const signalKey = `${type}\u0000${value}`;
      const topicSignals = countsByTopic.get(row.topicId) ?? new Map<string, TopicSignalStat>();
      topicSignals.set(signalKey, { type, value, count: row.cnt });
      countsByTopic.set(row.topicId, topicSignals);
    });

    return threadCounts.map((r) => ({
      topicId: r.topicId,
      threadCount: r.threadCount,
      messageCount: messageCountByTopic.get(r.topicId) ?? 0,
      topSignals: Array.from(countsByTopic.get(r.topicId)?.values() ?? []).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        const typeDiff = (signalTypeOrder.get(a.type) ?? 999) - (signalTypeOrder.get(b.type) ?? 999);
        if (typeDiff !== 0) return typeDiff;
        return a.value.localeCompare(b.value);
      })
    }));
  });
}
