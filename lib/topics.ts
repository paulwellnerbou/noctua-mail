import { randomUUID } from "crypto";
import { withAccountDb } from "./db";
import type { Topic, TopicColor } from "./data";

export type TopicSignalStat = { value: string; count: number };
export type TopicStat = { topicId: string; threadCount: number; topSignals: TopicSignalStat[] };

type MessageSignals = {
  fromEmail?: string | null;
  to?: string | null;
  cc?: string | null;
  listId?: string | null;
  /** threadId of the thread being evaluated — excluded from learning corpus */
  threadId?: string | null;
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

    return rows.map(rowToTopic);
  });
}
