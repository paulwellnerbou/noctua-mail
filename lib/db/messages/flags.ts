/**
 * Flag and category column mutations on the messages domain.
 *
 * The messages row stores its IMAP flag list as a JSON blob plus an
 * always-in-sync bitset of the canonical system flags
 * (seen/answered/flagged/…/unread). Every writer in this module funnels
 * through `deriveSystemFlagState` so the two representations cannot drift.
 *
 * `updateMessageFlags` additionally triggers a thread recompute because
 * thread-level signals (e.g. unreadCount) are materialized from these
 * bits; bulk and category writes leave thread state alone for
 * performance — callers that need thread invariants restored after a
 * bulk mutation request a recompute explicitly via the threads module.
 */
import { withDbWriteRetry } from "../../dbWriteRetry";
import { normalizeImapFlags } from "../../messageFlags";
import type { CategoryKey } from "../../mail/categorization/linearModel";
import { getAccountDb } from "../connection";
import { recomputeThreadsForAccountInternal } from "../threads";
import { deriveSystemFlagState } from "./_shared";

/**
 * Sets the flag list for one message and triggers a thread recompute so
 * unread / flagged / … signals on the thread reflect the new state.
 */
export async function updateMessageFlags(
  accountId: string,
  messageId: string,
  flags: string[]
) {
  return withDbWriteRetry("updateMessageFlags", async () => {
    const db = await getAccountDb(accountId);
    const normalizedFlags = normalizeImapFlags(flags);
    const system = deriveSystemFlagState(normalizedFlags);
    db.prepare(
      `UPDATE messages
       SET flags = ?,
           seen = ?,
           answered = ?,
           flagged = ?,
           deleted = ?,
           draft = ?,
           recent = ?,
           unread = ?
       WHERE accountId = ? AND id = ?`
    ).run(
      JSON.stringify(normalizedFlags),
      system.seen,
      system.answered,
      system.flagged,
      system.deleted,
      system.draft,
      system.recent,
      system.unread,
      accountId,
      messageId
    );
    const row = db
      .prepare(`SELECT threadId FROM messages WHERE accountId = ? AND id = ?`)
      .get(accountId, messageId) as { threadId?: string | null } | undefined;
    if (row?.threadId) {
      await recomputeThreadsForAccountInternal(accountId, [row.threadId]);
    }
  });
}

/**
 * Bulk variant used by sync: applies many flag changes in a single
 * transaction and intentionally skips the per-message thread recompute
 * (the caller triggers one pass afterwards, covering every touched
 * thread at once).
 */
export async function bulkUpdateMessageFlags(
  accountId: string,
  updates: Array<{ id: string; flags: string[] }>
) {
  if (updates.length === 0) return;
  return withDbWriteRetry("bulkUpdateMessageFlags", async () => {
    const db = await getAccountDb(accountId);
    const stmt = db.prepare(
      `UPDATE messages
       SET flags = ?,
           seen = ?,
           answered = ?,
           flagged = ?,
           deleted = ?,
           draft = ?,
           recent = ?,
           unread = ?
       WHERE accountId = ? AND id = ?`
    );
    const tx = db.transaction(() => {
      for (const update of updates) {
        const normalized = normalizeImapFlags(update.flags);
        const system = deriveSystemFlagState(normalized);
        stmt.run(
          JSON.stringify(normalized),
          system.seen,
          system.answered,
          system.flagged,
          system.deleted,
          system.draft,
          system.recent,
          system.unread,
          accountId,
          update.id
        );
      }
    });
    tx();
  });
}

/**
 * Stores the automatic categorization result (category + score + signal
 * breakdown) and clears any manual-state override. Writers that carry
 * user intent (`applyCategoryFeedback`) intentionally live next to the
 * category-model persistence code instead of here.
 */
export async function setMessageCategory(
  accountId: string,
  messageId: string,
  category: CategoryKey | null,
  categoryScore: number | null,
  categorySignals: string[]
) {
  return withDbWriteRetry("setMessageCategory", async () => {
    const db = await getAccountDb(accountId);
    db.prepare(
      `UPDATE messages
       SET category = ?, categoryScore = ?, categorySignals = ?, categoryManualState = NULL
       WHERE accountId = ? AND id = ?`
    ).run(
      category,
      typeof categoryScore === "number" ? categoryScore : null,
      JSON.stringify(categorySignals ?? []),
      accountId,
      messageId
    );
  });
}
