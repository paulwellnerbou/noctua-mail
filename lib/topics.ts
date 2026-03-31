import { randomUUID } from "crypto";
import {
  addTopicSignalExclusion,
  clearTopicSignalExclusions,
  deleteTopicLearningSignals,
  getThreadIdsByMessageIds,
  upsertTopicLearningSignalsForThreadIds,
  withAccountDb
} from "./db";
import type { Topic, TopicColor, TopicSuggestionSignal } from "./data";
import { TOPIC_COLORS, TOPIC_SUGGESTION_SIGNALS } from "./data";
import { withDbWriteRetry } from "./dbWriteRetry";
import { isFreeMailDomain } from "./senderIdentity";
import {
  collectTopicSignalEntries,
  type TopicSignalEntry,
  type TopicSignalSource
} from "./topicSignals";

export type TopicSignalStat = { type: TopicSuggestionSignal; value: string; count: number };
export type TopicStat = {
  topicId: string;
  threadCount: number;
  messageCount: number;
  topSignals: TopicSignalStat[];
};
export type TopicTransferTopic = Pick<
  Topic,
  "id" | "name" | "color" | "imapKeyword" | "createdAt" | "updatedAt"
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
export type TopicSuggestionExplanationSignal = {
  type: TopicSuggestionSignal;
  value: string;
  weight: number;
};
export type TopicSuggestionExplanationTopic = {
  topic: Topic;
  suggestionScore: number;
  matchCount: number;
  matchedSignals: TopicSuggestionExplanationSignal[];
  matchedThreads: Array<{
    threadId: string;
    score: number;
    signals: TopicSuggestionExplanationSignal[];
  }>;
};
export type TopicSuggestionExplanation = {
  signals: TopicSuggestionExplanationSignal[];
  topics: TopicSuggestionExplanationTopic[];
};
export type TopicThreadSuggestion = {
  threadId: string;
  representativeMessageId?: string;
  suggestionScore: number;
};

type MessageSignals = TopicSignalSource & {
  /** threadId of the thread being evaluated — excluded from learning corpus */
  threadId?: string | null;
};

type TopicSuggestionSignals = {
  senderEmails: string[];
  senderDomains: string[];
  recipientEmails: string[];
  listIds: string[];
  jiraProjectKeys: string[];
  threadId?: string | null;
};

type TopicThreadSignalRow = {
  threadId?: string | null;
  signalType?: string | null;
  signalValue?: string | null;
};

const TOPIC_SUGGESTION_WEIGHTS = {
  senderEmail: 4,
  listId: 4,
  jiraProjectKey: 4,
  recipient: 2,
  senderDomain: 1
} as const;

function getTopicSuggestionWeight(type: TopicSuggestionSignal) {
  return TOPIC_SUGGESTION_WEIGHTS[type];
}

function topicSuggestionSignalsFromEntries(
  entries: TopicSignalEntry[],
  threadId?: string | null
): TopicSuggestionSignals {
  const signals: TopicSuggestionSignals = {
    senderEmails: [],
    senderDomains: [],
    recipientEmails: [],
    listIds: [],
    jiraProjectKeys: [],
    threadId
  };

  entries.forEach((entry) => {
    if (entry.type === "senderEmail") {
      signals.senderEmails.push(entry.value);
    } else if (entry.type === "senderDomain") {
      signals.senderDomains.push(entry.value);
    } else if (entry.type === "recipient") {
      signals.recipientEmails.push(entry.value);
    } else if (entry.type === "listId") {
      signals.listIds.push(entry.value);
    } else if (entry.type === "jiraProjectKey") {
      signals.jiraProjectKeys.push(entry.value);
    }
  });

  return signals;
}

function topicSuggestionSignalEntries(signals: TopicSuggestionSignals): TopicSignalEntry[] {
  return [
    ...signals.senderEmails.map((value) => ({ type: "senderEmail" as const, value })),
    ...signals.senderDomains.map((value) => ({ type: "senderDomain" as const, value })),
    ...signals.recipientEmails.map((value) => ({ type: "recipient" as const, value })),
    ...signals.listIds.map((value) => ({ type: "listId" as const, value })),
    ...signals.jiraProjectKeys.map((value) => ({ type: "jiraProjectKey" as const, value }))
  ];
}

function shouldIgnoreTopicSuggestionSignal(
  entry: Pick<TopicSignalEntry, "type" | "value">,
  options?: {
    accountEmail?: string | null;
  }
) {
  const accountEmail = options?.accountEmail?.toLowerCase().trim() || null;
  const value = entry.value.trim();
  if (!value) return true;

  if (entry.type === "senderEmail") {
    const normalizedEmail = value.toLowerCase();
    if (accountEmail && normalizedEmail === accountEmail) {
      return true;
    }
    const domain = normalizedEmail.split("@")[1] ?? "";
    return isFreeMailDomain(domain);
  }

  if (entry.type === "senderDomain") {
    return isFreeMailDomain(value.toLowerCase());
  }

  if (entry.type === "recipient" && accountEmail && value.toLowerCase() === accountEmail) {
    return true;
  }

  return false;
}

function normalizeTopicSuggestionSignals(
  signals: MessageSignals,
  options?: {
    accountEmail?: string | null;
  }
): TopicSuggestionSignals {
  return topicSuggestionSignalsFromEntries(
    collectTopicSignalEntries([signals], {
      excludeAccountEmail: options?.accountEmail ?? null
    }).filter((entry) => !shouldIgnoreTopicSuggestionSignal(entry, options)),
    signals.threadId
  );
}

function topicSuggestionEntriesFromThreadSignalRows(
  rows: Array<Pick<TopicThreadSignalRow, "signalType" | "signalValue">>,
  options?: {
    accountEmail?: string | null;
  }
): TopicSignalEntry[] {
  return rows.flatMap((row) => {
    const type = (row.signalType ?? "").trim() as TopicSuggestionSignal;
    const value = (row.signalValue ?? "").trim();
    if (!TOPIC_SUGGESTION_SIGNALS.includes(type) || !value) return [];
    if (shouldIgnoreTopicSuggestionSignal({ type, value }, options)) {
      return [];
    }
    return [{ type, value }];
  });
}

function getTopicSuggestionSignalsForThreadsFromDb(
  db: any,
  accountId: string,
  threadIds: string[],
  options?: {
    accountEmail?: string | null;
  }
): Map<string, TopicSuggestionSignals> {
  const normalizedThreadIds = Array.from(
    new Set(threadIds.map((threadId) => threadId.trim()).filter(Boolean))
  );
  const result = new Map<string, TopicSuggestionSignals>();
  if (normalizedThreadIds.length === 0) return result;

  normalizedThreadIds.forEach((threadId) => {
    result.set(threadId, topicSuggestionSignalsFromEntries([], threadId));
  });

  const placeholders = normalizedThreadIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT threadId, signalType, signalValue
       FROM thread_signals
       WHERE accountId = ? AND threadId IN (${placeholders})
       ORDER BY threadId ASC, signalType ASC, signalValue ASC`
    )
    .all(accountId, ...normalizedThreadIds) as TopicThreadSignalRow[];

  let activeThreadId = "";
  let activeRows: TopicThreadSignalRow[] = [];

  const flush = () => {
    if (!activeThreadId) return;
    result.set(
      activeThreadId,
      topicSuggestionSignalsFromEntries(
        topicSuggestionEntriesFromThreadSignalRows(activeRows, options),
        activeThreadId
      )
    );
  };

  rows.forEach((row) => {
    const threadId = (row.threadId ?? "").trim();
    if (!threadId) return;
    if (threadId !== activeThreadId) {
      flush();
      activeThreadId = threadId;
      activeRows = [];
    }
    activeRows.push(row);
  });

  flush();
  return result;
}

async function getTopicSuggestionSignalsForThread(
  accountId: string,
  threadId: string,
  options?: {
    accountEmail?: string | null;
  }
): Promise<TopicSuggestionSignals> {
  return withAccountDb(accountId, (db) => {
    return (
      getTopicSuggestionSignalsForThreadsFromDb(db, accountId, [threadId], options).get(threadId) ??
      topicSuggestionSignalsFromEntries([], threadId)
    );
  });
}

function getTopicSuggestionsForSignals(
  db: any,
  accountId: string,
  signals: TopicSuggestionSignals
): Topic[] {
  const {
    senderEmails,
    senderDomains,
    recipientEmails,
    listIds,
    jiraProjectKeys,
    threadId
  } = signals;

  if (
    senderEmails.length === 0 &&
    senderDomains.length === 0 &&
    recipientEmails.length === 0 &&
    listIds.length === 0 &&
    jiraProjectKeys.length === 0
  ) {
    return [];
  }

  const signalEntries = topicSuggestionSignalEntries(signals);
  const conditions: string[] = [];
  const conditionArgs: any[] = [];
  signalEntries.forEach((entry) => {
    conditions.push(`(tls.signalType = ? AND tls.signalValue = ?)`);
    conditionArgs.push(entry.type, entry.value);
  });

  if (conditions.length === 0) return [];

  const scoreCaseSql =
    `CASE tls.signalType
       WHEN 'senderEmail' THEN ${TOPIC_SUGGESTION_WEIGHTS.senderEmail}
       WHEN 'listId' THEN ${TOPIC_SUGGESTION_WEIGHTS.listId}
       WHEN 'jiraProjectKey' THEN ${TOPIC_SUGGESTION_WEIGHTS.jiraProjectKey}
       WHEN 'recipient' THEN ${TOPIC_SUGGESTION_WEIGHTS.recipient}
       WHEN 'senderDomain' THEN ${TOPIC_SUGGESTION_WEIGHTS.senderDomain}
       ELSE 0
     END`;
  const queryArgs: any[] = [accountId, ...conditionArgs, ...(threadId ? [threadId] : []), accountId];

  const rows = db
    .prepare(
      `SELECT t.*,
              MAX(matches.threadScore) AS suggestionScore,
              COUNT(*) AS matchCount
       FROM topics t
       JOIN (
         SELECT tls.topicId,
                tls.threadId,
                SUM(${scoreCaseSql}) AS threadScore
         FROM topic_learning_signals tls
         WHERE tls.accountId = ?
           AND (${conditions.join(" OR ")})
           ${threadId ? "AND tls.threadId != ?" : ""}
         GROUP BY tls.topicId, tls.threadId
       ) matches ON matches.topicId = t.id
       WHERE t.accountId = ?
       GROUP BY t.id
       ORDER BY suggestionScore DESC, matchCount DESC, t.name ASC`
    )
    .all(...queryArgs) as any[];

  return rows.map((row) => ({
    ...rowToTopic(row),
    suggestionScore: row.suggestionScore as number,
    matchCount: row.matchCount as number
  }));
}

function getTopicSuggestionExplanationForSignals(
  db: any,
  accountId: string,
  signals: TopicSuggestionSignals
): TopicSuggestionExplanation {
  const signalEntries = topicSuggestionSignalEntries(signals);
  if (signalEntries.length === 0) {
    return { signals: [], topics: [] };
  }

  const conditions: string[] = [];
  const conditionArgs: any[] = [];
  signalEntries.forEach((entry) => {
    conditions.push(`(tls.signalType = ? AND tls.signalValue = ?)`);
    conditionArgs.push(entry.type, entry.value);
  });

  if (conditions.length === 0) {
    return { signals: [], topics: [] };
  }

  const queryArgs: any[] = [
    accountId,
    ...conditionArgs,
    ...(signals.threadId ? [signals.threadId] : []),
    accountId
  ];
  const rows = db
    .prepare(
      `SELECT t.*,
              tls.topicId,
              tls.threadId,
              tls.signalType,
              tls.signalValue
       FROM topic_learning_signals tls
       JOIN topics t
         ON t.id = tls.topicId
        AND t.accountId = tls.accountId
       WHERE tls.accountId = ?
         AND (${conditions.join(" OR ")})
         ${signals.threadId ? "AND tls.threadId != ?" : ""}
         AND t.accountId = ?
       ORDER BY t.name ASC, tls.threadId ASC, tls.signalType ASC, tls.signalValue ASC`
    )
    .all(...queryArgs) as Array<{
    topicId: string;
    threadId: string;
    signalType: TopicSuggestionSignal;
    signalValue: string;
  } & Record<string, any>>;

  const currentSignals = signalEntries.map((entry) => ({
    ...entry,
    weight: getTopicSuggestionWeight(entry.type)
  }));
  const topicsById = new Map<
    string,
    {
      topic: Topic;
      matchedSignals: Map<string, TopicSuggestionExplanationSignal>;
      matchedThreads: Map<
        string,
        {
          threadId: string;
          score: number;
          signals: Map<string, TopicSuggestionExplanationSignal>;
        }
      >;
    }
  >();

  rows.forEach((row) => {
    const type = (row.signalType ?? "").trim() as TopicSuggestionSignal;
    const value = (row.signalValue ?? "").trim();
    const threadId = (row.threadId ?? "").trim();
    if (!TOPIC_SUGGESTION_SIGNALS.includes(type) || !value || !threadId) return;
    const weight = getTopicSuggestionWeight(type);
    const signalKey = `${type}\u0000${value}`;
    const topicState = topicsById.get(row.topicId) ?? {
      topic: rowToTopic(row),
      matchedSignals: new Map<string, TopicSuggestionExplanationSignal>(),
      matchedThreads: new Map<
        string,
        {
          threadId: string;
          score: number;
          signals: Map<string, TopicSuggestionExplanationSignal>;
        }
      >()
    };
    topicState.matchedSignals.set(signalKey, { type, value, weight });
    const threadState = topicState.matchedThreads.get(threadId) ?? {
      threadId,
      score: 0,
      signals: new Map<string, TopicSuggestionExplanationSignal>()
    };
    if (!threadState.signals.has(signalKey)) {
      threadState.signals.set(signalKey, { type, value, weight });
      threadState.score += weight;
    }
    topicState.matchedThreads.set(threadId, threadState);
    topicsById.set(row.topicId, topicState);
  });

  const topics = Array.from(topicsById.values())
    .map((topicState) => {
      const matchedThreads = Array.from(topicState.matchedThreads.values())
        .map((threadState) => ({
          threadId: threadState.threadId,
          score: threadState.score,
          signals: Array.from(threadState.signals.values()).sort((a, b) => {
            if (b.weight !== a.weight) return b.weight - a.weight;
            if (a.type !== b.type) return a.type.localeCompare(b.type);
            return a.value.localeCompare(b.value);
          })
        }))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.threadId.localeCompare(b.threadId);
        });
      const suggestionScore = matchedThreads[0]?.score ?? 0;
      return {
        topic: {
          ...topicState.topic,
          suggestionScore,
          matchCount: matchedThreads.length
        },
        suggestionScore,
        matchCount: matchedThreads.length,
        matchedSignals: Array.from(topicState.matchedSignals.values()).sort((a, b) => {
          if (b.weight !== a.weight) return b.weight - a.weight;
          if (a.type !== b.type) return a.type.localeCompare(b.type);
          return a.value.localeCompare(b.value);
        }),
        matchedThreads
      };
    })
    .sort((a, b) => {
      if (b.suggestionScore !== a.suggestionScore) return b.suggestionScore - a.suggestionScore;
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return a.topic.name.localeCompare(b.topic.name);
    });

  return { signals: currentSignals, topics };
}

type NormalizedTopicTransferData = {
  version: 1;
  exportedAt: number;
  topics: TopicTransferTopic[];
  threads: TopicTransferThread[];
  learning: TopicTransferLearningSignal[];
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function buildImapKeyword(id: string): string {
  // IMAP keywords must be printable ASCII ATOM chars (RFC 3501).
  // Using the topic ID gives a stable, unique, readable-enough keyword.
  return `noctua-topic-${id}`;
}

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

function rememberTopicLearningForThread(
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

function rowToTopic(row: any): Topic {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
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
  color: TopicColor | null
): Promise<Topic> {
  const id = slugify(name) + "-" + randomUUID().slice(0, 8);
  const imapKeyword = buildImapKeyword(id);
  const now = Date.now();
  const topic: Topic = { id, accountId, name, color: color ?? null, imapKeyword, createdAt: now, updatedAt: now };

  await withAccountDb(accountId, (db) => {
    db.prepare(
      `INSERT INTO topics (id, accountId, name, color, imapKeyword, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, accountId, name, color ?? "", imapKeyword, now, now);
  });

  return topic;
}

export async function updateTopic(
  accountId: string,
  topicId: string,
  changes: { name?: string; color?: TopicColor | null }
): Promise<Topic | null> {
  return withAccountDb(accountId, (db) => {
    const now = Date.now();
    const sets: string[] = ["updatedAt = ?"];
    const values: any[] = [now];
    if (changes.name !== undefined) {
      sets.push("name = ?");
      values.push(changes.name);
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

export async function exportTopicTransferData(accountId: string): Promise<TopicTransferData> {
  return withAccountDb(accountId, (db) => {
    const topics = (db
      .prepare(`SELECT * FROM topics WHERE accountId = ? ORDER BY name ASC`)
      .all(accountId) as any[]).map((row) => {
      const topic = rowToTopic(row);
      return {
        id: topic.id,
        name: topic.name,
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
        `INSERT INTO topics (id, accountId, name, color, imapKeyword, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
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

/**
 * Suggest topics for a message based on past manual assignments.
 *
 * Derives suggestions purely from the thread_topics corpus — no manual rules.
 * For each signal present in the message (sender email, sender domain,
 * List-Id, Jira project key, recipient addresses), we look up topics that were previously
 * assigned to threads sharing that signal, and rank them by how often they
 * appear across matching threads.
 *
 * Topics already assigned to the current thread are excluded.
 */
export async function getTopicSuggestionsForMessage(
  accountId: string,
  signals: MessageSignals,
  options?: {
    accountEmail?: string | null;
  }
): Promise<Topic[]> {
  const normalizedSignals = normalizeTopicSuggestionSignals(signals, options);
  return withAccountDb(accountId, (db) => getTopicSuggestionsForSignals(db, accountId, normalizedSignals));
}

export async function getTopicSuggestionsForThread(
  accountId: string,
  threadId: string,
  options?: {
    accountEmail?: string | null;
  }
): Promise<Topic[]> {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) return [];
  const signals = await getTopicSuggestionSignalsForThread(accountId, normalizedThreadId, options);
  return withAccountDb(accountId, (db) => getTopicSuggestionsForSignals(db, accountId, signals));
}

export async function getTopicSuggestionExplanationForThread(
  accountId: string,
  threadId: string,
  options?: {
    accountEmail?: string | null;
  }
): Promise<TopicSuggestionExplanation> {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) return { signals: [], topics: [] };
  const signals = await getTopicSuggestionSignalsForThread(accountId, normalizedThreadId, options);
  return withAccountDb(accountId, (db) =>
    getTopicSuggestionExplanationForSignals(db, accountId, signals)
  );
}

export async function getTopicSuggestionsForThreads(
  accountId: string,
  threadIds: string[],
  options?: {
    accountEmail?: string | null;
  }
): Promise<Map<string, Topic[]>> {
  const normalizedThreadIds = Array.from(
    new Set(threadIds.map((threadId) => threadId.trim()).filter(Boolean))
  );
  if (normalizedThreadIds.length === 0) return new Map();

  return withAccountDb(accountId, (db) => {
    const signalsByThreadId = getTopicSuggestionSignalsForThreadsFromDb(
      db,
      accountId,
      normalizedThreadIds,
      options
    );
    const result = new Map<string, Topic[]>();

    normalizedThreadIds.forEach((threadId) => {
      const signals = signalsByThreadId.get(threadId);
      if (!signals) return;
      const suggestions = getTopicSuggestionsForSignals(db, accountId, signals);
      if (suggestions.length > 0) {
        result.set(threadId, suggestions);
      }
    });

    return result;
  });
}

type TopicSuggestionCandidateRow = {
  id: string;
  threadId: string;
  dateValue: number;
};

export async function getTopicThreadSuggestions(
  accountId: string,
  topicId: string,
  options?: {
    accountEmail?: string | null;
    limit?: number;
    maxAgeDays?: number;
  }
): Promise<TopicThreadSuggestion[]> {
  const normalizedTopicId = topicId.trim();
  if (!normalizedTopicId) return [];

  const limit = Math.max(1, Math.min(50, Math.trunc(options?.limit ?? 5) || 5));
  const maxAgeDays = Math.max(1, Math.min(3650, Math.trunc(options?.maxAgeDays ?? 180) || 180));
  const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;

  return withAccountDb(accountId, (db) => {
    const topicExists = db
      .prepare(`SELECT 1 FROM topics WHERE id = ? AND accountId = ?`)
      .get(normalizedTopicId, accountId) as { 1?: number } | undefined;
    if (!topicExists) return [];

    const inboxFolderRow = db
      .prepare(
        `SELECT id
         FROM folders
         WHERE accountId = ?
           AND (
             lower(COALESCE(specialUse, '')) = '\\inbox'
             OR lower(name) = 'inbox'
           )
         ORDER BY
           CASE WHEN lower(COALESCE(specialUse, '')) = '\\inbox' THEN 0 ELSE 1 END,
           CASE WHEN lower(name) = 'inbox' THEN 0 ELSE 1 END,
           id ASC
         LIMIT 1`
      )
      .get(accountId) as { id?: string | null } | undefined;
    const inboxFolderId = String(inboxFolderRow?.id ?? "").trim();
    if (!inboxFolderId) return [];

    const candidateRows = db
      .prepare(
        `SELECT
           m.id,
           m.threadId,
           m.dateValue
         FROM messages m
         WHERE m.accountId = ?
           AND m.folderId = ?
           AND COALESCE(m.deleted, 0) = 0
           AND m.dateValue >= ?
           AND NOT EXISTS (
             SELECT 1
             FROM thread_topics tt
             WHERE tt.accountId = m.accountId
               AND tt.threadId = m.threadId
           )
           AND m.id = (
             SELECT m2.id
             FROM messages m2
             WHERE m2.accountId = m.accountId
               AND m2.threadId = m.threadId
               AND m2.folderId = ?
               AND COALESCE(m2.deleted, 0) = 0
             ORDER BY m2.dateValue DESC, m2.id DESC
             LIMIT 1
           )
         ORDER BY m.dateValue DESC, m.id DESC`
      )
      .all(accountId, inboxFolderId, cutoffMs, inboxFolderId) as TopicSuggestionCandidateRow[];

    if (candidateRows.length === 0) return [];

    const candidateRowsByThreadId = new Map<string, TopicSuggestionCandidateRow>();
    candidateRows.forEach((row) => {
      const threadId = String(row.threadId ?? "").trim();
      if (!threadId || candidateRowsByThreadId.has(threadId)) return;
      candidateRowsByThreadId.set(threadId, row);
    });
    const candidateThreadIds = Array.from(candidateRowsByThreadId.keys());
    if (candidateThreadIds.length === 0) return [];

    const signalsByThreadId = getTopicSuggestionSignalsForThreadsFromDb(
      db,
      accountId,
      candidateThreadIds,
      { accountEmail: options?.accountEmail }
    );

    const suggestions: TopicThreadSuggestion[] = [];
    candidateThreadIds.forEach((threadId) => {
      const signals = signalsByThreadId.get(threadId);
      if (!signals) return;
      const topicMatch = getTopicSuggestionsForSignals(db, accountId, signals).find(
        (topic) => topic.id === normalizedTopicId
      );
      if (!topicMatch) return;
      const row = candidateRowsByThreadId.get(threadId);
      if (!row) return;
      suggestions.push({
        threadId,
        representativeMessageId: row.id,
        suggestionScore: topicMatch.suggestionScore ?? 0
      });
    });

    suggestions.sort((a, b) => {
      if (b.suggestionScore !== a.suggestionScore) {
        return b.suggestionScore - a.suggestionScore;
      }
      const aRow = candidateRowsByThreadId.get(a.threadId);
      const bRow = candidateRowsByThreadId.get(b.threadId);
      if ((bRow?.dateValue ?? 0) !== (aRow?.dateValue ?? 0)) {
        return (bRow?.dateValue ?? 0) - (aRow?.dateValue ?? 0);
      }
      return a.threadId.localeCompare(b.threadId);
    });

    return suggestions.slice(0, limit);
  });
}
