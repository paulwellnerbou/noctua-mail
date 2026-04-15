import {
  getThreadIdsByMessageIds,
  upsertTopicLearningSignalsForThreadIds,
  withAccountDb
} from "../db";
import type { Topic, TopicColor, TopicSuggestionSignal } from "../data";
import { TOPIC_COLORS, TOPIC_SUGGESTION_SIGNALS } from "../data";
import { withDbWriteRetry } from "../dbWriteRetry";
import { buildImapKeyword, normalizeTopicShortName, rowToTopic } from "./core";

export type TopicTransferTopic = Pick<
  Topic,
  "id" | "name" | "shortName" | "color" | "imapKeyword" | "createdAt" | "updatedAt"
>;
export type TopicTransferThread = {
  threadId: string;
  topicIds: string[];
  messageIds: string[];
};
export type TopicTransferLearningSignal = {
  threadId: string;
  topicId: string;
  signalType: TopicSuggestionSignal;
  signalValue: string;
  messageIds: string[];
};
export type TopicTransferData = {
  version: 1;
  exportedAt: number;
  topics: TopicTransferTopic[];
  threads: TopicTransferThread[];
  learning?: TopicTransferLearningSignal[];
};
export type TopicTransferImportSummary = {
  topicCount: number;
  threadCount: number;
  assignmentCount: number;
  resolvedThreadCount: number;
  unresolvedThreadCount: number;
};

type NormalizedTopicTransferData = {
  version: 1;
  exportedAt: number;
  topics: TopicTransferTopic[];
  threads: TopicTransferThread[];
  learning: TopicTransferLearningSignal[];
};

function normalizeTopicColor(value: unknown): TopicColor | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return (TOPIC_COLORS as readonly string[]).includes(trimmed) ? (trimmed as TopicColor) : null;
}

function normalizeTransferStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  value.forEach((entry) => {
    if (typeof entry !== "string") return;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    normalized.push(trimmed);
  });
  return normalized;
}

function normalizeTransferTimestamp(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeTopicSuggestionSignal(value: unknown): TopicSuggestionSignal | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim() as TopicSuggestionSignal;
  return TOPIC_SUGGESTION_SIGNALS.includes(trimmed) ? trimmed : null;
}

function normalizeTopicTransferData(input: unknown): NormalizedTopicTransferData {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid topics data file.");
  }
  const raw = input as Record<string, unknown>;
  if (raw.version !== 1) {
    throw new Error("Unsupported topics data version.");
  }

  const now = Date.now();
  const rawTopics = raw.topics;
  if (!Array.isArray(rawTopics)) {
    throw new Error("Invalid topics data file.");
  }

  const topics: TopicTransferTopic[] = [];
  const topicIds = new Set<string>();
  rawTopics.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Invalid topics data file.");
    }
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!id || !name) {
      throw new Error("Invalid topics data file.");
    }
    if (topicIds.has(id)) {
      throw new Error(`Duplicate topic ID in topics data: ${id}`);
    }
    topicIds.add(id);
    topics.push({
      id,
      name,
      shortName: normalizeTopicShortName(row.shortName),
      color: normalizeTopicColor(row.color),
      imapKeyword: buildImapKeyword(id),
      createdAt: normalizeTransferTimestamp(row.createdAt, now),
      updatedAt: normalizeTransferTimestamp(row.updatedAt, now)
    });
  });

  const rawThreads = raw.threads;
  if (!Array.isArray(rawThreads)) {
    throw new Error("Invalid topics data file.");
  }

  const threadsById = new Map<string, { topicIds: Set<string>; messageIds: Set<string> }>();
  rawThreads.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new Error("Invalid topics data file.");
    }
    const row = entry as Record<string, unknown>;
    const threadId = typeof row.threadId === "string" ? row.threadId.trim() : "";
    if (!threadId) {
      throw new Error("Invalid topics data file.");
    }
    const nextTopicIds = normalizeTransferStringArray(row.topicIds);
    if (nextTopicIds.length === 0) return;
    nextTopicIds.forEach((topicId) => {
      if (!topicIds.has(topicId)) {
        throw new Error(`Topics data references unknown topic: ${topicId}`);
      }
    });
    const nextMessageIds = normalizeTransferStringArray(row.messageIds);
    const existing = threadsById.get(threadId) ?? { topicIds: new Set<string>(), messageIds: new Set<string>() };
    nextTopicIds.forEach((topicId) => existing.topicIds.add(topicId));
    nextMessageIds.forEach((messageId) => existing.messageIds.add(messageId));
    threadsById.set(threadId, existing);
  });

  const learning: TopicTransferLearningSignal[] = [];
  const rawLearning = raw.learning;
  if (rawLearning !== undefined) {
    if (!Array.isArray(rawLearning)) {
      throw new Error("Invalid topics data file.");
    }
    const seenLearning = new Set<string>();
    rawLearning.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        throw new Error("Invalid topics data file.");
      }
      const row = entry as Record<string, unknown>;
      const threadId = typeof row.threadId === "string" ? row.threadId.trim() : "";
      const topicId = typeof row.topicId === "string" ? row.topicId.trim() : "";
      const signalType = normalizeTopicSuggestionSignal(row.signalType);
      const signalValue = typeof row.signalValue === "string" ? row.signalValue.trim() : "";
      if (!threadId || !topicId || !signalType || !signalValue) {
        throw new Error("Invalid topics data file.");
      }
      if (!topicIds.has(topicId)) {
        throw new Error(`Topics data references unknown topic: ${topicId}`);
      }
      const messageIds = normalizeTransferStringArray(row.messageIds);
      const learningKey = `${threadId}\u0000${topicId}\u0000${signalType}\u0000${signalValue}`;
      if (seenLearning.has(learningKey)) return;
      seenLearning.add(learningKey);
      learning.push({
        threadId,
        topicId,
        signalType,
        signalValue,
        messageIds
      });
    });
  }

  return {
    version: 1,
    exportedAt: normalizeTransferTimestamp(raw.exportedAt, now),
    topics,
    threads: Array.from(threadsById.entries())
      .map(([threadId, value]) => ({
        threadId,
        topicIds: Array.from(value.topicIds).sort(),
        messageIds: Array.from(value.messageIds)
      }))
      .sort((a, b) => a.threadId.localeCompare(b.threadId)),
    learning
  };
}

function getTransferMessageIdsByThread(db: any, accountId: string, threadIds: string[]) {
  const result = new Map<string, string[]>();
  if (threadIds.length === 0) return result;

  const seenByThread = new Map<string, Set<string>>();
  const batchSize = 400;
  for (let start = 0; start < threadIds.length; start += batchSize) {
    const chunk = threadIds.slice(start, start + batchSize);
    const rows = db
      .prepare(
        `SELECT threadId, messageId, dateValue, id
         FROM messages
         WHERE accountId = ?
           AND threadId IN (${chunk.map(() => "?").join(",")})
           AND COALESCE(messageId, '') <> ''
         ORDER BY threadId ASC, dateValue ASC, id ASC`
      )
      .all(accountId, ...chunk) as Array<{
      threadId?: string | null;
      messageId?: string | null;
    }>;

    rows.forEach((row) => {
      const threadId = String(row.threadId ?? "").trim();
      const messageId = String(row.messageId ?? "").trim();
      if (!threadId || !messageId) return;
      const seen = seenByThread.get(threadId) ?? new Set<string>();
      if (seen.has(messageId)) return;
      seen.add(messageId);
      seenByThread.set(threadId, seen);
      const list = result.get(threadId) ?? [];
      list.push(messageId);
      result.set(threadId, list);
    });
  }

  return result;
}

function resolveImportedThreadId(
  thread: TopicTransferThread,
  threadIdsByMessageId: Map<string, string>
) {
  if (threadIdsByMessageId.has(thread.threadId)) {
    return { threadId: threadIdsByMessageId.get(thread.threadId)!, resolved: true };
  }
  for (const messageId of thread.messageIds) {
    const resolvedThreadId = threadIdsByMessageId.get(messageId);
    if (resolvedThreadId) {
      return { threadId: resolvedThreadId, resolved: true };
    }
  }
  return { threadId: thread.threadId, resolved: false };
}

export async function exportTopicTransferData(accountId: string): Promise<TopicTransferData> {
  return withAccountDb(accountId, (db) => {
    const topics = (db
      .prepare(`SELECT * FROM topics WHERE accountId = ? ORDER BY name ASC`)
      .all(accountId) as any[]).map((row) => {
      const topic = rowToTopic(row);
      return {
        id: topic.id,
        name: topic.name,
        shortName: topic.shortName,
        color: topic.color,
        imapKeyword: topic.imapKeyword,
        createdAt: topic.createdAt,
        updatedAt: topic.updatedAt
      };
    });

    const rows = db
      .prepare(
        `SELECT threadId, topicId
         FROM thread_topics
         WHERE accountId = ?
         ORDER BY threadId ASC, topicId ASC`
      )
      .all(accountId) as Array<{ threadId?: string | null; topicId?: string | null }>;

    const threadIds = Array.from(
      new Set(rows.map((row) => String(row.threadId ?? "").trim()).filter(Boolean))
    );
    const messageIdsByThread = getTransferMessageIdsByThread(db, accountId, threadIds);
    const threadsById = new Map<string, { topicIds: Set<string>; messageIds: string[] }>();

    rows.forEach((row) => {
      const threadId = String(row.threadId ?? "").trim();
      const topicId = String(row.topicId ?? "").trim();
      if (!threadId || !topicId) return;
      const existing = threadsById.get(threadId) ?? {
        topicIds: new Set<string>(),
        messageIds: messageIdsByThread.get(threadId) ?? []
      };
      existing.topicIds.add(topicId);
      threadsById.set(threadId, existing);
    });

    const learningRows = db
      .prepare(
        `SELECT threadId, topicId, signalType, signalValue
         FROM topic_learning_signals
         WHERE accountId = ?
         ORDER BY threadId ASC, topicId ASC, signalType ASC, signalValue ASC`
      )
      .all(accountId) as Array<{
      threadId?: string | null;
      topicId?: string | null;
      signalType?: string | null;
      signalValue?: string | null;
    }>;

    return {
      version: 1,
      exportedAt: Date.now(),
      topics,
      threads: Array.from(threadsById.entries()).map(([threadId, value]) => ({
        threadId,
        topicIds: Array.from(value.topicIds).sort(),
        messageIds: value.messageIds
      })),
      learning: learningRows
        .map((row) => {
          const threadId = String(row.threadId ?? "").trim();
          const topicId = String(row.topicId ?? "").trim();
          const signalType = normalizeTopicSuggestionSignal(row.signalType);
          const signalValue = String(row.signalValue ?? "").trim();
          if (!threadId || !topicId || !signalType || !signalValue) return null;
          return {
            threadId,
            topicId,
            signalType,
            signalValue,
            messageIds: messageIdsByThread.get(threadId) ?? []
          } satisfies TopicTransferLearningSignal;
        })
        .filter((entry): entry is TopicTransferLearningSignal => Boolean(entry))
    };
  });
}

export async function importTopicTransferData(
  accountId: string,
  input: unknown
): Promise<TopicTransferImportSummary> {
  const data = normalizeTopicTransferData(input);
  const threadLookupIds = Array.from(
    new Set([
      ...data.threads.flatMap((thread) => [thread.threadId, ...thread.messageIds]),
      ...data.learning.flatMap((entry) => [entry.threadId, ...entry.messageIds])
    ])
  );
  const threadIdsByMessageId = await getThreadIdsByMessageIds(accountId, threadLookupIds);

  return withDbWriteRetry("importTopicTransferData", async () =>
    withAccountDb(accountId, (db) => {
      const clearThreadTopics = db.prepare(`DELETE FROM thread_topics WHERE accountId = ?`);
      const clearTopicLearningSignals = db.prepare(`DELETE FROM topic_learning_signals WHERE accountId = ?`);
      const clearTopicSignalExclusions = db.prepare(`DELETE FROM topic_signal_exclusions WHERE accountId = ?`);
      const clearTopics = db.prepare(`DELETE FROM topics WHERE accountId = ?`);
      const insertTopic = db.prepare(
        `INSERT INTO topics (id, accountId, name, shortName, color, imapKeyword, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertThreadTopic = db.prepare(
        `INSERT OR IGNORE INTO thread_topics (threadId, topicId, accountId, assignedAt)
         VALUES (?, ?, ?, ?)`
      );
      const insertTopicLearningSignal = db.prepare(
        `INSERT OR IGNORE INTO topic_learning_signals (accountId, topicId, threadId, signalType, signalValue)
         VALUES (?, ?, ?, ?, ?)`
      );

      const applyImport = db.transaction(() => {
        clearThreadTopics.run(accountId);
        clearTopicLearningSignals.run(accountId);
        clearTopicSignalExclusions.run(accountId);
        clearTopics.run(accountId);

        data.topics.forEach((topic) => {
          insertTopic.run(
            topic.id,
            accountId,
            topic.name,
            normalizeTopicShortName(topic.shortName),
            topic.color ?? "",
            buildImapKeyword(topic.id),
            topic.createdAt,
            topic.updatedAt
          );
        });

        const importedAt = Date.now();
        let assignmentCount = 0;
        let resolvedThreadCount = 0;
        let unresolvedThreadCount = 0;

        data.threads.forEach((thread) => {
          const resolvedThread = resolveImportedThreadId(thread, threadIdsByMessageId);
          if (resolvedThread.resolved) resolvedThreadCount += 1;
          else unresolvedThreadCount += 1;

          thread.topicIds.forEach((topicId) => {
            insertThreadTopic.run(resolvedThread.threadId, topicId, accountId, importedAt);
            assignmentCount += 1;
          });
        });

        if (data.learning.length > 0) {
          data.learning.forEach((entry) => {
            const resolvedThread = resolveImportedThreadId({
              threadId: entry.threadId,
              topicIds: [entry.topicId],
              messageIds: entry.messageIds
            }, threadIdsByMessageId);
            insertTopicLearningSignal.run(
              accountId,
              entry.topicId,
              resolvedThread.threadId,
              entry.signalType,
              entry.signalValue
            );
          });
        } else {
          const importedThreadIds = Array.from(new Set(data.threads.map((thread) => {
            const resolvedThread = resolveImportedThreadId(thread, threadIdsByMessageId);
            return resolvedThread.threadId;
          })));
          upsertTopicLearningSignalsForThreadIds(db, accountId, importedThreadIds);
        }

        return {
          topicCount: data.topics.length,
          threadCount: data.threads.length,
          assignmentCount,
          resolvedThreadCount,
          unresolvedThreadCount
        };
      });

      return applyImport() as TopicTransferImportSummary;
    })
  );
}
