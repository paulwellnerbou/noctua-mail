/**
 * Draft tombstones — a small "do-not-resurrect" ledger for drafts that
 * have been sent or discarded locally.
 *
 * The client treats the local store as the source of truth and reconciles
 * IMAP asynchronously. That opens a window where a draft can be removed
 * locally while its copy still lingers on the IMAP server (the delete
 * raced an in-flight APPEND, the delete failed, or another client is
 * lagging). Without a guard, the next Drafts folder sync would re-import
 * that orphan and the draft would reappear next to the message the user
 * already sent.
 *
 * A tombstone records, by stable Message-Id, that a draft is gone for
 * good. The sync import path consults it to drop (and schedule deletion
 * of) any matching draft the server still reports. Tombstones are keyed on
 * Message-Id rather than the local row id because a draft's row id churns
 * across re-saves while its Message-Id is preserved.
 *
 * Enforcement is scoped to `\Draft`-flagged messages only, so the Sent
 * copy — which may legitimately share the Message-Id when a draft is sent
 * from its stored MIME source — is never affected.
 */
import { withDbWriteRetry } from "../../dbWriteRetry";
import { getAccountDb } from "../connection";

// Tombstones are tiny but should not accumulate forever. A week is far
// longer than any realistic IMAP sync lag, after which an orphan draft
// would have been reconciled (or genuinely no longer exists).
const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Records that the draft with the given Message-Id has been sent or
 * discarded and must not be re-imported from IMAP. Idempotent. Also prunes
 * tombstones older than the TTL so the table stays small.
 */
export async function recordDraftTombstone(
  accountId: string,
  messageId: string | null | undefined,
  mailboxPath: string | null = null
) {
  const trimmed = messageId?.trim();
  if (!trimmed) return;
  return withDbWriteRetry("recordDraftTombstone", async () => {
    const db = await getAccountDb(accountId);
    const now = Date.now();
    db.prepare(
      `INSERT INTO draft_tombstones (accountId, messageId, mailboxPath, createdAtMs)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(accountId, messageId) DO UPDATE SET
         mailboxPath = excluded.mailboxPath,
         createdAtMs = excluded.createdAtMs`
    ).run(accountId, trimmed, mailboxPath, now);
    db.prepare(`DELETE FROM draft_tombstones WHERE accountId = ? AND createdAtMs < ?`).run(
      accountId,
      now - TOMBSTONE_TTL_MS
    );
  });
}

/**
 * Returns the subset of the given Message-Ids that are tombstoned for this
 * account. Used by the sync import path to decide which incoming drafts to
 * drop instead of inserting.
 */
export async function getTombstonedDraftMessageIds(
  accountId: string,
  messageIds: Array<string | null | undefined>
): Promise<Set<string>> {
  const unique = Array.from(
    new Set(messageIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))
  );
  if (unique.length === 0) return new Set();
  const db = await getAccountDb(accountId);
  const found = new Set<string>();
  // Chunk the IN clause to stay under SQLite's bound-parameter limit, as the
  // other id-batched queries in this domain do.
  const CHUNK_SIZE = 500;
  for (let start = 0; start < unique.length; start += CHUNK_SIZE) {
    const chunk = unique.slice(start, start + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT messageId FROM draft_tombstones
         WHERE accountId = ? AND messageId IN (${placeholders})`
      )
      .all(accountId, ...chunk) as Array<{ messageId?: string }>;
    for (const row of rows) {
      const value = String(row.messageId ?? "");
      if (value) found.add(value);
    }
  }
  return found;
}

/**
 * Drops a tombstone once its IMAP copy has been confirmed deleted, so a
 * brand-new draft that later reuses the same Message-Id (unlikely, but
 * possible across re-composes) is not silently suppressed.
 */
export async function removeDraftTombstone(accountId: string, messageId: string | null | undefined) {
  const trimmed = messageId?.trim();
  if (!trimmed) return;
  return withDbWriteRetry("removeDraftTombstone", async () => {
    const db = await getAccountDb(accountId);
    db.prepare(`DELETE FROM draft_tombstones WHERE accountId = ? AND messageId = ?`).run(
      accountId,
      trimmed
    );
  });
}
