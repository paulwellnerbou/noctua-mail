import { randomUUID } from "crypto";
import { getThreadIdsByMessageIds, withAccountDb } from "./db";
import type { Topic, TopicColor } from "./data";
import { TOPIC_COLORS } from "./data";
import { withDbWriteRetry } from "./dbWriteRetry";

export type TopicSignalStat = { value: string; count: number };
export type TopicStat = { topicId: string; threadCount: number; topSignals: TopicSignalStat[] };
export type TopicTransferTopic = Pick<
  Topic,
  "id" | "name" | "color" | "imapKeyword" | "createdAt" | "updatedAt"
>;
export type TopicTransferThread = {
  threadId: string;
  topicIds: string[];
  messageIds: string[];
};
export type TopicTransferData = {
  version: 1;
  exportedAt: number;
  topics: TopicTransferTopic[];
  threads: TopicTransferThread[];
};
export type TopicTransferImportSummary = {
  topicCount: number;
  threadCount: number;
  assignmentCount: number;
  resolvedThreadCount: number;
  unresolvedThreadCount: number;
};

type MessageSignals = {
  fromEmail?: string | null;
  to?: string | null;
  cc?: string | null;
  listId?: string | null;
  /** threadId of the thread being evaluated — excluded from learning corpus */
  threadId?: string | null;
};

type NormalizedTopicTransferData = {
  version: 1;
  exportedAt: number;
  topics: TopicTransferTopic[];
  threads: TopicTransferThread[];
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
      .sort((a, b) => a.threadId.localeCompare(b.threadId))
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
    db.prepare(`DELETE FROM thread_topics WHERE threadId = ? AND accountId = ?`).run(
      threadId,
      accountId
    );
    for (const topicId of topicIds) {
      db.prepare(
        `INSERT OR IGNORE INTO thread_topics (threadId, topicId, accountId, assignedAt)
         VALUES (?, ?, ?, ?)`
      ).run(threadId, topicId, accountId, now);
    }
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

export async function addThreadTopic(
  accountId: string,
  threadId: string,
  topicId: string
): Promise<void> {
  await withAccountDb(accountId, (db) => {
    db.prepare(
      `INSERT OR IGNORE INTO thread_topics (threadId, topicId, accountId, assignedAt)
       VALUES (?, ?, ?, ?)`
    ).run(threadId, topicId, accountId, Date.now());
  });
}

export async function removeThreadTopic(
  accountId: string,
  threadId: string,
  topicId: string
): Promise<void> {
  await withAccountDb(accountId, (db) => {
    db.prepare(
      `DELETE FROM thread_topics WHERE threadId = ? AND topicId = ? AND accountId = ?`
    ).run(threadId, topicId, accountId);
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

    return {
      version: 1,
      exportedAt: Date.now(),
      topics,
      threads: Array.from(threadsById.entries()).map(([threadId, value]) => ({
        threadId,
        topicIds: Array.from(value.topicIds).sort(),
        messageIds: value.messageIds
      }))
    };
  });
}

export async function importTopicTransferData(
  accountId: string,
  input: unknown
): Promise<TopicTransferImportSummary> {
  const data = normalizeTopicTransferData(input);
  const threadLookupIds = Array.from(
    new Set(data.threads.flatMap((thread) => [thread.threadId, ...thread.messageIds]))
  );
  const threadIdsByMessageId = await getThreadIdsByMessageIds(accountId, threadLookupIds);

  return withDbWriteRetry("importTopicTransferData", async () =>
    withAccountDb(accountId, (db) => {
      const clearThreadTopics = db.prepare(`DELETE FROM thread_topics WHERE accountId = ?`);
      const clearTopics = db.prepare(`DELETE FROM topics WHERE accountId = ?`);
      const insertTopic = db.prepare(
        `INSERT INTO topics (id, accountId, name, color, imapKeyword, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const insertThreadTopic = db.prepare(
        `INSERT OR IGNORE INTO thread_topics (threadId, topicId, accountId, assignedAt)
         VALUES (?, ?, ?, ?)`
      );

      const applyImport = db.transaction(() => {
        clearThreadTopics.run(accountId);
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
 * Return per-topic learning statistics: thread count and top signal values.
 * Used to visualize how much the system has learned about each topic.
 */
export async function getTopicStats(accountId: string): Promise<TopicStat[]> {
  return withAccountDb(accountId, (db) => {
    const threadCounts = db
      .prepare(
        `SELECT topicId, COUNT(DISTINCT threadId) AS threadCount
         FROM thread_topics WHERE accountId = ? GROUP BY topicId`
      )
      .all(accountId) as Array<{ topicId: string; threadCount: number }>;

    if (threadCounts.length === 0) return [];

    // Top signals: prefer listId (most specific), fall back to sender domain.
    const signalRows = db
      .prepare(
        `SELECT tt.topicId,
                COALESCE(
                  m.listId,
                  CASE WHEN instr(m.fromEmail, '@') > 0
                       THEN lower(substr(m.fromEmail, instr(m.fromEmail, '@') + 1))
                       ELSE NULL END
                ) AS signal,
                COUNT(DISTINCT tt.threadId) AS cnt
         FROM thread_topics tt
         JOIN messages m ON m.threadId = tt.threadId AND m.accountId = tt.accountId
         WHERE tt.accountId = ?
           AND (m.listId IS NOT NULL OR m.fromEmail IS NOT NULL)
         GROUP BY tt.topicId, signal
         ORDER BY cnt DESC`
      )
      .all(accountId) as Array<{ topicId: string; signal: string | null; cnt: number }>;

    // Group signals by topicId, keep top 5.
    const signalsByTopic = new Map<string, TopicSignalStat[]>();
    for (const row of signalRows) {
      if (!row.signal) continue;
      const list = signalsByTopic.get(row.topicId) ?? [];
      if (list.length < 5) list.push({ value: row.signal, count: row.cnt });
      signalsByTopic.set(row.topicId, list);
    }

    return threadCounts.map((r) => ({
      topicId: r.topicId,
      threadCount: r.threadCount,
      topSignals: signalsByTopic.get(r.topicId) ?? []
    }));
  });
}

/**
 * Suggest topics for a message based on past manual assignments.
 *
 * Derives suggestions purely from the thread_topics corpus — no manual rules.
 * For each signal present in the message (sender email, sender domain,
 * List-Id, recipient addresses), we look up topics that were previously
 * assigned to threads sharing that signal, and rank them by how often they
 * appear across matching threads.
 *
 * Topics already assigned to the current thread are excluded.
 */
export async function getTopicSuggestionsForMessage(
  accountId: string,
  signals: MessageSignals
): Promise<Topic[]> {
  const senderEmail = signals.fromEmail?.toLowerCase().trim() || null;
  const senderDomain = senderEmail?.includes("@") ? senderEmail.split("@")[1] : null;
  const listId = signals.listId?.trim() || null;

  // Extract individual email addresses from to/cc fields (comma-separated).
  const recipientEmails = [signals.to, signals.cc]
    .filter(Boolean)
    .flatMap((field) =>
      (field as string)
        .split(/,|;/)
        .map((part) => {
          const m = part.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/i);
          return m ? m[0].toLowerCase() : null;
        })
        .filter((e): e is string => Boolean(e))
    );

  if (!senderEmail && !listId && recipientEmails.length === 0) return [];

  return withAccountDb(accountId, (db) => {
    // Build a scored list: for each past assignment, check how many signals match.
    // More matching signals → higher score. Topics already on this thread are excluded.
    const conditions: string[] = [];
    const conditionArgs: any[] = [];

    if (senderEmail) {
      conditions.push(`lower(m.fromEmail) = ?`);
      conditionArgs.push(senderEmail);
    }
    if (senderDomain) {
      conditions.push(`(m.fromEmail IS NOT NULL AND lower(m.fromEmail) LIKE ?)`);
      conditionArgs.push(`%@${senderDomain}`);
    }
    if (listId) {
      conditions.push(`m.listId = ?`);
      conditionArgs.push(listId);
    }
    for (const email of recipientEmails) {
      conditions.push(`(lower(m.toAddr) LIKE ? OR lower(COALESCE(m.ccAddr,'')) LIKE ?)`);
      conditionArgs.push(`%${email}%`, `%${email}%`);
    }

    if (conditions.length === 0) return [];

    const excludeClause = signals.threadId ? `AND tt.threadId != ?` : "";
    const queryArgs: any[] = [
      accountId,
      ...conditionArgs,
      ...(signals.threadId ? [signals.threadId] : [])
    ];

    const rows = db
      .prepare(
        `SELECT t.*, COUNT(DISTINCT tt.threadId) AS matchCount
         FROM topics t
         JOIN thread_topics tt ON tt.topicId = t.id AND tt.accountId = t.accountId
         JOIN messages m ON m.threadId = tt.threadId AND m.accountId = tt.accountId
         WHERE t.accountId = ?
           AND (${conditions.join(" OR ")})
           ${excludeClause}
         GROUP BY t.id
         ORDER BY matchCount DESC, t.name ASC`
      )
      .all(...queryArgs) as any[];

    return rows.map((row) => ({ ...rowToTopic(row), matchCount: row.matchCount as number }));
  });
}
