/**
 * Backfill for `messages.sizeBytes`, the byte length of a message's stored
 * raw `.eml`.
 *
 * New messages get the size for free when sync writes the source
 * (`sanitizeSyncedMessage`). Rows that predate the column carry NULL, which
 * sorts last and would make a size-ordered list useless, so they are filled
 * in from the account's source directory.
 */
import { getAccountDb } from "../connection";
import { listMessageSourceSizes } from "../../storage";
import { buildMessageRowIdLookupCandidates } from "../../messageIds";

/** Rows filled per SQLite transaction; caps memory while avoiding autocommit churn. */
const WRITE_BATCH_SIZE = 500;

export type MessageSizeBackfillResult = {
  /** Rows that got a byte count written. */
  filled: number;
  /** Rows whose source file was gone; `sizeBytes` stays NULL. */
  missing: number;
};

type AccountDb = Awaited<ReturnType<typeof getAccountDb>>;

function countMissingSizes(db: AccountDb, accountId: string) {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM messages
       WHERE accountId = ? AND sizeBytes IS NULL AND COALESCE(hasSource, 0) = 1`
    )
    .get(accountId) as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

/**
 * Fill `sizeBytes` for every row of `accountId` that claims a stored source
 * but has no recorded size. Idempotent: once every row is either filled or
 * known-missing this costs a single COUNT.
 *
 * `onProgress` is called after each flushed batch.
 */
export async function backfillMessageSourceSizes(
  accountId: string,
  options?: { onProgress?: (result: MessageSizeBackfillResult) => void }
): Promise<MessageSizeBackfillResult> {
  const db = await getAccountDb(accountId);
  const result: MessageSizeBackfillResult = { filled: 0, missing: 0 };
  if (countMissingSizes(db, accountId) === 0) return result;

  const sizesById = await listMessageSourceSizes(accountId);
  const rows = db
    .prepare(
      `SELECT id
       FROM messages
       WHERE accountId = ? AND sizeBytes IS NULL AND COALESCE(hasSource, 0) = 1`
    )
    .all(accountId) as Array<{ id?: string | null }>;

  const update = db.prepare(`UPDATE messages SET sizeBytes = ? WHERE accountId = ? AND id = ?`);
  const flush = db.transaction((batch: Array<{ id: string; sizeBytes: number }>) => {
    batch.forEach((entry) => update.run(entry.sizeBytes, accountId, entry.id));
  });

  let pending: Array<{ id: string; sizeBytes: number }> = [];
  for (const row of rows) {
    const id = (row.id ?? "").trim();
    if (!id) continue;
    // Collision-variant rows fall back to the base id's file, mirroring how
    // `getMessageSource` resolves the source it would actually serve.
    const sizeBytes = buildMessageRowIdLookupCandidates(id)
      .map((candidateId) => sizesById.get(candidateId))
      .find((size) => typeof size === "number");
    if (sizeBytes === undefined) {
      result.missing += 1;
      continue;
    }
    pending.push({ id, sizeBytes });
    result.filled += 1;
    if (pending.length >= WRITE_BATCH_SIZE) {
      flush(pending);
      pending = [];
      options?.onProgress?.({ ...result });
    }
  }
  if (pending.length > 0) {
    flush(pending);
    options?.onProgress?.({ ...result });
  }
  return result;
}

const backfillsByAccountId = new Map<string, Promise<MessageSizeBackfillResult>>();

/**
 * Runs `backfillMessageSourceSizes` at most once per account per process, and
 * only once concurrently. Rows whose source file is missing stay NULL, so
 * without the cache every size-ordered request would re-walk them; re-fetching
 * a source records its size directly (`sanitizeSyncedMessage`), so nothing
 * depends on this pass running again.
 */
export function ensureMessageSourceSizes(accountId: string) {
  const existing = backfillsByAccountId.get(accountId);
  if (existing) return existing;
  const started = backfillMessageSourceSizes(accountId).catch((error) => {
    // A failed pass must not be cached as done — the next request retries.
    backfillsByAccountId.delete(accountId);
    throw error;
  });
  backfillsByAccountId.set(accountId, started);
  return started;
}
