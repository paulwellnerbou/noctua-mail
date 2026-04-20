/**
 * Cross-folder move operations on the messages domain. IMAP moves are
 * inherently asynchronous: the client "stages" a move by repointing the
 * local row at the destination folder while preserving the source UID so
 * the eventual server COPY/EXPUNGE can be reconciled. Once the server-side
 * move completes the row is "relocated" to finalize the new UID and clear
 * the pending-move breadcrumb.
 *
 * Additionally, `updateMessagesFolderPrefix` rewrites folder identifiers in
 * bulk so renaming a folder subtree in IMAP stays cheap locally.
 */
import { withDbWriteRetry } from "../../dbWriteRetry";
import { getAccountDb } from "../connection";
import { escapeLikePattern } from "./_shared";

/**
 * Returns every `pendingMoveSourceUid` currently staged against the given
 * source folder. Sync uses this to skip re-ingesting a message that is
 * still flight-pending.
 */
export async function getPendingMoveSourceUids(accountId: string, sourceFolderId: string) {
  const normalizedSourceFolderId = sourceFolderId.trim();
  if (!normalizedSourceFolderId) return new Set<number>();
  const db = await getAccountDb(accountId);
  const rows = db
    .prepare(
      `SELECT pendingMoveSourceUid
       FROM messages
       WHERE accountId = ?
         AND pendingMoveSourceFolderId = ?
         AND pendingMoveSourceUid IS NOT NULL`
    )
    .all(accountId, normalizedSourceFolderId) as Array<{
    pendingMoveSourceUid?: number | null;
  }>;
  return new Set(
    rows
      .map((row) => row.pendingMoveSourceUid)
      .filter((uid): uid is number => typeof uid === "number" && Number.isFinite(uid))
  );
}

/**
 * True when the folder has any message that is either staged for a move
 * out of it, or was staged into it but not yet finalized. UI uses this to
 * show a syncing indicator on the folder row.
 */
export async function hasPendingMovesForFolder(accountId: string, folderId: string) {
  const normalizedFolderId = folderId.trim();
  if (!normalizedFolderId) return false;
  const db = await getAccountDb(accountId);
  const row = db
    .prepare(
      `SELECT 1
       FROM messages
       WHERE accountId = ?
         AND (
           pendingMoveSourceFolderId = ?
           OR (folderId = ? AND pendingMoveSourceFolderId IS NOT NULL)
         )
       LIMIT 1`
    )
    .get(accountId, normalizedFolderId, normalizedFolderId) as
    | { 1?: number }
    | undefined;
  return Boolean(row);
}

/**
 * Finalizes a move by repointing a message at its destination folder. The
 * three branches distinguish explicit UID clearing (null), a known
 * destination UID, and an unknown UID so callers can update whichever
 * subset of fields they actually know about.
 */
export async function updateMessageFolder(
  accountId: string,
  messageId: string,
  folderId: string,
  mailboxPath: string,
  imapUid?: number | null
) {
  return withDbWriteRetry("updateMessageFolder", async () => {
    const db = await getAccountDb(accountId);
    if (imapUid === null) {
      db.prepare(
        `UPDATE messages
         SET folderId = ?,
             mailboxPath = ?,
             imapUid = NULL,
             pendingMoveSourceFolderId = NULL,
             pendingMoveSourceMailboxPath = NULL,
             pendingMoveSourceUid = NULL,
             pendingMoveStartedAt = NULL
         WHERE accountId = ? AND id = ?`
      ).run(folderId, mailboxPath, accountId, messageId);
      return;
    }
    if (typeof imapUid === "number" && Number.isFinite(imapUid)) {
      db.prepare(
        `UPDATE messages
         SET folderId = ?,
             mailboxPath = ?,
             imapUid = ?,
             pendingMoveSourceFolderId = NULL,
             pendingMoveSourceMailboxPath = NULL,
             pendingMoveSourceUid = NULL,
             pendingMoveStartedAt = NULL
         WHERE accountId = ? AND id = ?`
      ).run(folderId, mailboxPath, imapUid, accountId, messageId);
      return;
    }
    db.prepare(
      `UPDATE messages
       SET folderId = ?,
           mailboxPath = ?,
           pendingMoveSourceFolderId = NULL,
           pendingMoveSourceMailboxPath = NULL,
           pendingMoveSourceUid = NULL,
           pendingMoveStartedAt = NULL
       WHERE accountId = ? AND id = ?`
    ).run(folderId, mailboxPath, accountId, messageId);
  });
}

export type StagedMessageMove = {
  messageId: string;
  sourceFolderId: string;
  sourceMailboxPath: string;
  sourceUid: number;
  destinationFolderId: string;
  destinationMailboxPath: string;
};

/**
 * Stages moves for a batch of messages: repoints each row at the
 * destination folder while preserving its source UID so the server-side
 * move can be driven asynchronously. Messages already at the destination
 * or already staged for a different move are silently skipped (the
 * returned list reflects only the rows that actually transitioned).
 */
export async function stageMessageMoves(params: {
  accountId: string;
  messageIds: string[];
  destinationFolderId: string;
  destinationMailboxPath: string;
}) {
  const { accountId, messageIds, destinationFolderId, destinationMailboxPath } = params;
  const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [] as StagedMessageMove[];
  return withDbWriteRetry("stageMessageMoves", async () => {
    const db = await getAccountDb(accountId);
    const pendingMoveStartedAt = Date.now();
    // Whole-thread moves can pass arrays larger than SQLite's default
    // 999-parameter limit. Chunk the SELECT at the shared
    // QUERY_BATCH_SIZE.
    const QUERY_BATCH_SIZE = 400;
    type Row = {
      id: string;
      folderId: string;
      mailboxPath?: string | null;
      imapUid?: number | null;
      pendingMoveSourceFolderId?: string | null;
    };
    const rows: Row[] = [];
    for (let start = 0; start < uniqueIds.length; start += QUERY_BATCH_SIZE) {
      const chunk = uniqueIds.slice(start, start + QUERY_BATCH_SIZE);
      const batchRows = db
        .prepare(
          `SELECT id, folderId, mailboxPath, imapUid, pendingMoveSourceFolderId
           FROM messages
           WHERE accountId = ? AND id IN (${chunk.map(() => "?").join(",")})`
        )
        .all(accountId, ...chunk) as Row[];
      rows.push(...batchRows);
    }
    const updateMessage = db.prepare(
      `UPDATE messages
       SET folderId = ?,
           mailboxPath = ?,
           imapUid = NULL,
           pendingMoveSourceFolderId = ?,
           pendingMoveSourceMailboxPath = ?,
           pendingMoveSourceUid = ?,
           pendingMoveStartedAt = ?
       WHERE accountId = ? AND id = ?`
    );
    const staged: StagedMessageMove[] = [];
    db.transaction(() => {
      rows.forEach((row) => {
        if (
          typeof row.imapUid !== "number" ||
          !Number.isFinite(row.imapUid) ||
          !row.mailboxPath ||
          !row.folderId
        ) {
          return;
        }
        if (
          row.folderId === destinationFolderId &&
          row.mailboxPath === destinationMailboxPath
        ) {
          return;
        }
        if (row.pendingMoveSourceFolderId) {
          return;
        }
        updateMessage.run(
          destinationFolderId,
          destinationMailboxPath,
          row.folderId,
          row.mailboxPath,
          row.imapUid,
          pendingMoveStartedAt,
          accountId,
          row.id
        );
        staged.push({
          messageId: row.id,
          sourceFolderId: row.folderId,
          sourceMailboxPath: row.mailboxPath,
          sourceUid: row.imapUid,
          destinationFolderId,
          destinationMailboxPath
        });
      });
    })();
    return staged;
  });
}

export type RelocateMovedMessageResult = {
  previousId: string;
  nextId: string;
  attachmentIds: string[];
  changed: boolean;
};

/**
 * Finalizes a previously-staged move by clearing the pending-move
 * breadcrumb and optionally stamping the destination UID. Returns the
 * attachment ids so the storage layer can migrate their on-disk blobs if
 * needed.
 */
export async function relocateMovedMessage(params: {
  accountId: string;
  previousId: string;
  destinationFolderId: string;
  destinationMailboxPath: string;
  destinationUid?: number | null;
}) {
  const {
    accountId,
    previousId,
    destinationFolderId,
    destinationMailboxPath,
    destinationUid
  } = params;
  return withDbWriteRetry("relocateMovedMessage", async () => {
    const db = await getAccountDb(accountId);
    const normalizedPreviousId = previousId.trim();
    const existing = db
      .prepare(`SELECT id FROM messages WHERE accountId = ? AND id = ?`)
      .get(accountId, normalizedPreviousId) as { id: string } | undefined;
    if (!existing) return null;

    const attachmentIds = (db
      .prepare(`SELECT id FROM attachments WHERE messageId = ?`)
      .all(normalizedPreviousId) as Array<{ id?: string | null }>)
      .map((row) => (row.id ? String(row.id) : ""))
      .filter(Boolean);
    if (destinationUid === null) {
      db.prepare(
        `UPDATE messages
         SET folderId = ?,
             mailboxPath = ?,
             imapUid = NULL,
             pendingMoveSourceFolderId = NULL,
             pendingMoveSourceMailboxPath = NULL,
             pendingMoveSourceUid = NULL,
             pendingMoveStartedAt = NULL
         WHERE accountId = ? AND id = ?`
      ).run(destinationFolderId, destinationMailboxPath, accountId, normalizedPreviousId);
    } else if (typeof destinationUid === "number" && Number.isFinite(destinationUid)) {
      db.prepare(
        `UPDATE messages
         SET folderId = ?,
             mailboxPath = ?,
             imapUid = ?,
             pendingMoveSourceFolderId = NULL,
             pendingMoveSourceMailboxPath = NULL,
             pendingMoveSourceUid = NULL,
             pendingMoveStartedAt = NULL
         WHERE accountId = ? AND id = ?`
      ).run(
        destinationFolderId,
        destinationMailboxPath,
        destinationUid,
        accountId,
        normalizedPreviousId
      );
    } else {
      db.prepare(
        `UPDATE messages
         SET folderId = ?,
             mailboxPath = ?,
             pendingMoveSourceFolderId = NULL,
             pendingMoveSourceMailboxPath = NULL,
             pendingMoveSourceUid = NULL,
             pendingMoveStartedAt = NULL
         WHERE accountId = ? AND id = ?`
      ).run(destinationFolderId, destinationMailboxPath, accountId, normalizedPreviousId);
    }

    return {
      previousId: normalizedPreviousId,
      nextId: normalizedPreviousId,
      attachmentIds,
      changed: false
    } satisfies RelocateMovedMessageResult;
  });
}

/**
 * Rewrites folderId and mailboxPath in bulk when a folder subtree is
 * renamed. The two columns are stored denormalized, so both must be
 * patched together to keep the invariant `folderId == accountId + ":" +
 * mailboxPath` intact.
 *
 * The rewrite uses prefix-only surgery (`? || substr(column, prefixLen + 1)`)
 * rather than `REPLACE`, which substitutes every occurrence of the
 * needle in the haystack and corrupts paths like `Foo/FooBar` when
 * renaming `Foo` → `Bar`.
 *
 * Scoping is delimiter-aware. The UPDATE matches two cases:
 *   1. `folderId = oldFull` — the renamed folder itself.
 *   2. `folderId LIKE oldFull || <delimiter> || '%'` — only descendants,
 *      never siblings. Without the delimiter guard, renaming `Foo`
 *      would also match the sibling `FooBar` and turn it into `BarBar`.
 *
 * The delimiter is read from the `folders` table for the renamed
 * folder; falls back to `/` if the row is missing (e.g. the rename
 * caller has already updated the folders table).
 */
export async function updateMessagesFolderPrefix(
  accountId: string,
  oldPrefix: string,
  newPrefix: string
) {
  return withDbWriteRetry("updateMessagesFolderPrefix", async () => {
    const db = await getAccountDb(accountId);
    const oldFull = `${accountId}:${oldPrefix}`;
    const newFull = `${accountId}:${newPrefix}`;
    const folderRow = db
      .prepare(
        `SELECT delimiter FROM folders WHERE accountId = ? AND id = ? LIMIT 1`
      )
      .get(accountId, oldFull) as { delimiter?: string | null } | undefined;
    const delimiter = folderRow?.delimiter || "/";
    const childPattern = `${escapeLikePattern(oldFull)}${escapeLikePattern(delimiter)}%`;
    db.prepare(
      `UPDATE messages
       SET folderId = ? || substr(folderId, length(?) + 1),
           mailboxPath = ? || substr(mailboxPath, length(?) + 1)
       WHERE accountId = ?
         AND (folderId = ? OR folderId LIKE ? ESCAPE '\\')`
    ).run(
      newFull,
      oldFull,
      newPrefix,
      oldPrefix,
      accountId,
      oldFull,
      childPattern
    );
  });
}
