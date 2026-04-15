import { withAccountDb } from "../db";
import type { Topic, TopicSuggestionSignal } from "../data";
import { TOPIC_SUGGESTION_SIGNALS } from "../data";
import { isFreeMailDomain } from "../senderIdentity";
import {
  collectTopicSignalEntries,
  type TopicSignalEntry,
  type TopicSignalSource
} from "../topicSignals";
import { rowToTopic } from "./core";

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
