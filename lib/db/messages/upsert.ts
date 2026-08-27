/**
 * The single write path that takes a batch of parsed RFC 5322 messages
 * and installs them into the local SQLite store. The function is large
 * because it maintains several invariants atomically:
 *
 *   - **Row identity under mailbox collision.** When the same Message-Id
 *     appears in two different mailboxes, a deterministic variant id
 *     (`buildMessageCollisionVariantId`) is minted so both copies can
 *     coexist. The incoming (colliding) row is assigned the variant id;
 *     the pre-existing row keeps its base id and its on-disk
 *     source/attachment files untouched.
 *   - **Same-mailbox duplicate purge.** If a message arrives with a
 *     Message-Id that already exists in the same folder but under a
 *     different row id (sync delta, for example), the older row plus
 *     its attachment / FTS / calendar-event siblings are deleted.
 *   - **Flag reconciliation.** Raw IMAP flags are normalized and
 *     preserved alongside any local-only flags the user has added. The
 *     JSON `flags` column and the system-flag bitset are projected from
 *     the same normalized list.
 *   - **Manual category preservation.** Rows that the user explicitly
 *     marked "cleared" stay cleared across re-upserts even if the
 *     incoming message carries an automatic classification.
 *   - **Calendar-invite state preservation.** When a message is
 *     re-upserted, its existing `message_calendar_events` entries for
 *     the same event UIDs are re-emitted with their prior processed
 *     state so invite bookkeeping (processedAtMs, processedByUserId,
 *     processedAutomatically) survives.
 *   - **Thread signal + topic learning recompute.** After the batch
 *     lands, the affected threads have their signals rebuilt and topic
 *     learning state refreshed. `replaceExisting` + account-scoped
 *     writes escalate to a full-account recompute.
 */
import type { Message } from "../../data";
import { createHash } from "crypto";
import { withDbWriteRetry } from "../../dbWriteRetry";
import { normalizeImapFlags, preserveLocalOnlyMessageFlags } from "../../messageFlags";
import {
  normalizeCalendarEventUid,
  normalizeCalendarEventUidKey,
  normalizeCalendarEventUids
} from "../../calendarEventUids";
import { isSameMailboxMessageCopy } from "../../messageCopies";
import { getAccountDb } from "../connection";
import {
  pruneThreadTopicsWithoutMessages,
  rebuildAllThreadSignalsForAccount,
  rebuildThreadSignalsForThreadIds,
  recomputeThreadsForAccountInternal
} from "../threads";
import { upsertTopicLearningSignalsForThreadIds } from "../topics";
import {
  type CategoryManualState,
  deriveSystemFlagState,
  normalizeCategory,
  safeParseJson
} from "./_shared";

/**
 * Derives a deterministic variant id for a message that collides with
 * an existing row from a different mailbox. The suffix hashes mailbox
 * path + UID so the same (message, mailbox, uid) triple always yields
 * the same variant, which keeps attachment file paths stable across
 * re-upserts.
 */
function buildMessageCollisionVariantId(
  baseId: string,
  mailboxPath?: string | null,
  imapUid?: number | null
) {
  const normalizedMailboxPath = (mailboxPath ?? "").trim().toLowerCase();
  const normalizedUid =
    typeof imapUid === "number" && Number.isFinite(imapUid) ? String(imapUid) : "";
  const suffix = createHash("sha1")
    .update(`${baseId}|${normalizedMailboxPath}|${normalizedUid}`)
    .digest("hex")
    .slice(0, 12);
  return `${baseId}-${suffix}`;
}

/** Narrows a stored `categoryManualState` value to the known union. */
function normalizeCategoryManualState(value?: string | null): CategoryManualState | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "cleared") return "cleared";
  return null;
}

export async function upsertMessages(
  accountId: string,
  folderId: string | null,
  nextMessages: Message[],
  replaceExisting = false,
  options: { recomputeThreads?: boolean } = {}
) {
  return withDbWriteRetry("upsertMessages", async () => {
    const shouldRecomputeThreads = options.recomputeThreads ?? true;
    const UPSERT_BATCH_SIZE = 200;
    const yieldToEventLoop = () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    const db = await getAccountDb(accountId);
    const deleteSql = folderId
      ? `DELETE FROM messages WHERE accountId = ? AND folderId = ?`
      : `DELETE FROM messages WHERE accountId = ?`;
    const deleteArgs = folderId ? [accountId, folderId] : [accountId];
    const deleteAttachmentsByScope = folderId
      ? db.prepare(
          `DELETE FROM attachments WHERE messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId = ?)`
        )
      : db.prepare(
          `DELETE FROM attachments WHERE messageId IN (SELECT id FROM messages WHERE accountId = ?)`
        );
    const deleteCalendarEventsByScope = folderId
      ? db.prepare(
          `DELETE FROM message_calendar_events
           WHERE accountId = ?
             AND messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId = ?)`
        )
      : db.prepare(`DELETE FROM message_calendar_events WHERE accountId = ?`);
    const deleteAttachmentsForMessage = db.prepare(
      `DELETE FROM attachments WHERE messageId = ?`
    );
    const deleteCalendarEventsForMessage = db.prepare(
      `DELETE FROM message_calendar_events WHERE accountId = ? AND messageId = ?`
    );
    const selectCalendarEventsForMessage = db.prepare(
      `SELECT
         eventUid,
         eventUidKey,
         eventFirstStartAtMs,
         eventLastEndAtMs,
         inviteActionType,
         processedAtMs,
         processedByUserId,
         processedAutomatically,
         unprocessedReason,
         snapshotJson,
         snapshotVersion
       FROM message_calendar_events
       WHERE accountId = ? AND messageId = ?`
    );
    const deleteMessageById = db.prepare(`DELETE FROM messages WHERE accountId = ? AND id = ?`);
    const findMessageById = db.prepare(
      `SELECT id, folderId, mailboxPath, imapUid, flags, sizeBytes
       FROM messages
       WHERE accountId = ? AND id = ?`
    );
    const findFolderMessageDuplicates = db.prepare(
      `SELECT id, threadId, folderId, mailboxPath, imapUid
       FROM messages
       WHERE accountId = ? AND folderId = ? AND messageId = ? AND id <> ?`
    );
    const deleteFtsByScope = folderId
      ? db.prepare(
          `DELETE FROM message_fts WHERE messageId IN (SELECT id FROM messages WHERE accountId = ? AND folderId = ?)`
        )
      : db.prepare(
          `DELETE FROM message_fts WHERE messageId IN (SELECT id FROM messages WHERE accountId = ?)`
        );
    const insertAttachment = db.prepare(
      `INSERT OR REPLACE INTO attachments (id, messageId, filename, contentType, size, inline, cid, url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertCalendarEvent = db.prepare(
      `INSERT OR REPLACE INTO message_calendar_events (
         accountId,
         messageId,
         eventUid,
         eventUidKey,
         eventFirstStartAtMs,
         eventLastEndAtMs,
         inviteActionType,
         processedAtMs,
         processedByUserId,
         processedAutomatically,
         unprocessedReason,
         snapshotJson,
         snapshotVersion
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertMessage = db.prepare(`
      INSERT OR REPLACE INTO messages (
        id, accountId, folderId, threadId, parentId, messageId, inReplyTo, "references", xForwardedMessageId, xComposeFormat, quotedHtmlEdited,
        subject, fromAddr, fromEmail, replyToAddr, toAddr, ccAddr, bccAddr, mailboxPath, imapUid, preview, date, dateValue,
        body, htmlBody, priority, hasSource, unread, flags, seen, answered, flagged, deleted, draft, recent,
        category, categoryScore, categorySignals, categoryManualState, listUnsubscribe, listId, sizeBytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare(`
      INSERT INTO message_fts (messageId, subject, fromAddr, toAddr, ccAddr, bccAddr, body, preview)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteFts = db.prepare(`DELETE FROM message_fts WHERE messageId = ?`);
    const deleteMessages = db.prepare(deleteSql);
    const existingScopeThreadIds =
      replaceExisting && folderId
        ? new Set(
            (
              db
                .prepare(
                  `SELECT DISTINCT threadId
                   FROM messages
                   WHERE accountId = ? AND folderId = ?`
                )
                .all(accountId, folderId) as Array<{ threadId: string | null }>
            )
              .map((row) => row.threadId)
              .filter((id): id is string => Boolean(id))
          )
        : null;
    const existingAccountThreadIds =
      replaceExisting && !folderId
        ? new Set(
            (
              db
                .prepare(
                  `SELECT DISTINCT threadId
                   FROM messages
                   WHERE accountId = ?`
                )
                .all(accountId) as Array<{ threadId: string | null }>
            )
              .map((row) => row.threadId)
              .filter((id): id is string => Boolean(id))
          )
        : null;
    const manualCategoryStateByMessageId = new Map<string, CategoryManualState>();
    const rememberManualCategoryState = (rows: Array<{ id?: string | null; categoryManualState?: string | null }>) => {
      rows.forEach((row) => {
        const id = (row.id ?? "").trim();
        if (!id) return;
        const manualState = normalizeCategoryManualState(row.categoryManualState);
        if (manualState) {
          manualCategoryStateByMessageId.set(id, manualState);
        }
      });
    };
    const loadManualCategoryStatesForMessageIds = (messageIds: string[]) => {
      const uniqueIds = Array.from(new Set(messageIds.map((id) => id.trim()).filter(Boolean)));
      if (uniqueIds.length === 0) return;
      const QUERY_BATCH_SIZE = 400;
      for (let start = 0; start < uniqueIds.length; start += QUERY_BATCH_SIZE) {
        const chunk = uniqueIds.slice(start, start + QUERY_BATCH_SIZE);
        if (chunk.length === 0) continue;
        const rows = db
          .prepare(
            `SELECT id, categoryManualState
             FROM messages
             WHERE accountId = ?
               AND categoryManualState IS NOT NULL
               AND id IN (${chunk.map(() => "?").join(",")})`
          )
          .all(accountId, ...chunk) as Array<{ id?: string | null; categoryManualState?: string | null }>;
        rememberManualCategoryState(rows);
      }
    };
    if (replaceExisting) {
      const rows = (folderId
        ? db
            .prepare(
              `SELECT id, categoryManualState
               FROM messages
               WHERE accountId = ? AND folderId = ? AND categoryManualState IS NOT NULL`
            )
            .all(accountId, folderId)
        : db
            .prepare(
              `SELECT id, categoryManualState
               FROM messages
               WHERE accountId = ? AND categoryManualState IS NOT NULL`
            )
            .all(accountId)) as Array<{ id?: string | null; categoryManualState?: string | null }>;
      rememberManualCategoryState(rows);
    } else {
      loadManualCategoryStatesForMessageIds(nextMessages.map((message) => message.id));
    }
    const dedupedThreadIds = new Set<string>();
    const upsertBatch = db.transaction(
      (batch: Message[], shouldDeleteAttachments: boolean) => {
      batch.forEach((message) => {
        let rowId = message.id;
        const existingById = findMessageById.get(accountId, rowId) as
          | {
              id: string;
              folderId?: string | null;
              mailboxPath?: string | null;
              imapUid?: number | null;
              flags?: string | null;
              sizeBytes?: number | null;
            }
          | undefined;
        let existingRow = existingById;
        if (existingById && !isSameMailboxMessageCopy(existingById, message)) {
          rowId = buildMessageCollisionVariantId(
            message.id,
            message.mailboxPath ?? message.folderId,
            message.imapUid ?? null
          );
          // Keep any existing on-disk blobs attached to the base message id.
          // The existing database row remains at `message.id`, so moving
          // files from the base id to the collision variant would orphan
          // the base row's source / attachment paths. Variant rows already
          // fall back to the base id during lookup (see
          // `buildMessageRowIdLookupCandidates`); the reverse direction is
          // not guaranteed. The newly-assigned variant row is fresh and
          // will fetch its own source/attachments on first access.
          existingRow = findMessageById.get(accountId, rowId) as typeof existingById;
        }
        if (message.messageId) {
          const duplicates = findFolderMessageDuplicates.all(
            accountId,
            message.folderId,
            message.messageId,
            rowId
          ) as Array<{
            id: string;
            threadId: string | null;
            folderId?: string | null;
            mailboxPath?: string | null;
            imapUid?: number | null;
          }>;
          duplicates.forEach((row) => {
            if (!isSameMailboxMessageCopy(row, message)) {
              return;
            }
            deleteAttachmentsForMessage.run(row.id);
            deleteCalendarEventsForMessage.run(accountId, row.id);
            deleteFts.run(row.id);
            deleteMessageById.run(accountId, row.id);
            if (row.threadId) {
              dedupedThreadIds.add(row.threadId);
            }
          });
        }
        if (shouldDeleteAttachments) {
          deleteAttachmentsForMessage.run(rowId);
        }
        const preservedCalendarInviteStateByUid = new Map(
          (
            selectCalendarEventsForMessage.all(accountId, rowId) as Array<{
              eventUid?: string | null;
              eventUidKey?: string | null;
              eventFirstStartAtMs?: number | null;
              eventLastEndAtMs?: number | null;
              inviteActionType?: string | null;
              processedAtMs?: number | null;
              processedByUserId?: string | null;
              processedAutomatically?: number | boolean | null;
              unprocessedReason?: string | null;
              snapshotJson?: string | null;
              snapshotVersion?: number | null;
            }>
          )
            .map((row) => {
              const eventUid = normalizeCalendarEventUid(row.eventUid);
              if (!eventUid) return null;
              return [
                eventUid,
                {
                  eventUidKey:
                    typeof row.eventUidKey === "string" && row.eventUidKey.trim()
                      ? row.eventUidKey.trim()
                      : normalizeCalendarEventUidKey(eventUid),
                  eventFirstStartAtMs:
                    typeof row.eventFirstStartAtMs === "number" &&
                    Number.isFinite(row.eventFirstStartAtMs) &&
                    row.eventFirstStartAtMs > 0
                      ? row.eventFirstStartAtMs
                      : null,
                  eventLastEndAtMs:
                    row.eventLastEndAtMs === null || row.eventLastEndAtMs === undefined
                      ? null
                      : typeof row.eventLastEndAtMs === "number" &&
                          Number.isFinite(row.eventLastEndAtMs) &&
                          row.eventLastEndAtMs > 0
                        ? row.eventLastEndAtMs
                        : null,
                  inviteActionType: row.inviteActionType ?? null,
                  processedAtMs:
                    typeof row.processedAtMs === "number" && Number.isFinite(row.processedAtMs)
                      ? row.processedAtMs
                      : null,
                  processedByUserId:
                    typeof row.processedByUserId === "string" && row.processedByUserId.trim()
                      ? row.processedByUserId.trim()
                      : null,
                  processedAutomatically:
                    typeof row.processedAutomatically === "boolean"
                      ? row.processedAutomatically
                      : typeof row.processedAutomatically === "number"
                        ? row.processedAutomatically !== 0
                        : null,
                  unprocessedReason:
                    typeof row.unprocessedReason === "string" && row.unprocessedReason.trim()
                      ? row.unprocessedReason.trim()
                      : null,
                  snapshotJson:
                    typeof row.snapshotJson === "string" && row.snapshotJson.trim()
                      ? row.snapshotJson
                      : null,
                  snapshotVersion:
                    typeof row.snapshotVersion === "number" &&
                    Number.isFinite(row.snapshotVersion)
                      ? row.snapshotVersion
                      : null
                }
              ] as const;
            })
            .filter(
              (
                entry
              ): entry is readonly [
                string,
                {
                  eventUidKey: string | null;
                  eventFirstStartAtMs: number | null;
                  eventLastEndAtMs: number | null;
                  inviteActionType: string | null;
                  processedAtMs: number | null;
                  processedByUserId: string | null;
                  processedAutomatically: boolean | null;
                  unprocessedReason: string | null;
                  snapshotJson: string | null;
                  snapshotVersion: number | null;
                }
              ] => Boolean(entry)
            )
        );
        deleteCalendarEventsForMessage.run(accountId, rowId);
        const hasRawFlags = Array.isArray(message.flags);
        const existingFlags = safeParseJson<string[]>(existingById?.flags);
        const normalizedFlags = hasRawFlags
          ? preserveLocalOnlyMessageFlags(message.flags, existingFlags)
          : normalizeImapFlags(message.flags);
        const normalizedSystemFlags = deriveSystemFlagState(normalizedFlags);
        const seen = hasRawFlags ? Boolean(normalizedSystemFlags.seen) : Boolean(message.seen);
        const answered = hasRawFlags
          ? Boolean(normalizedSystemFlags.answered)
          : Boolean(message.answered);
        const flagged = hasRawFlags
          ? Boolean(normalizedSystemFlags.flagged)
          : Boolean(message.flagged);
        const deleted = hasRawFlags ? Boolean(normalizedSystemFlags.deleted) : Boolean(message.deleted);
        const draft = hasRawFlags ? Boolean(normalizedSystemFlags.draft) : Boolean(message.draft);
        const recent = hasRawFlags ? Boolean(normalizedSystemFlags.recent) : Boolean(message.recent);
        const unread = hasRawFlags
          ? Boolean(normalizedSystemFlags.unread)
          : typeof message.unread === "boolean"
            ? message.unread
            : !seen;
        const manualCategoryState =
          manualCategoryStateByMessageId.get(rowId) ??
          manualCategoryStateByMessageId.get(message.id) ??
          null;
        // INSERT OR REPLACE rewrites the whole row, so a source-less upsert
        // (envelope-only sync fallback) would otherwise drop a size the
        // stored .eml still backs.
        const sizeBytes =
          typeof message.sizeBytes === "number" && Number.isFinite(message.sizeBytes)
            ? message.sizeBytes
            : typeof existingRow?.sizeBytes === "number"
              ? existingRow.sizeBytes
              : null;
        const category =
          manualCategoryState === "cleared" ? null : normalizeCategory(message.category) ?? null;
        const categoryScore =
          manualCategoryState === "cleared"
            ? null
            : typeof message.categoryScore === "number"
              ? message.categoryScore
              : null;
        const categorySignals =
          manualCategoryState === "cleared"
            ? ["manual-category:cleared", "manual-feedback:negative"]
            : message.categorySignals;
        const emailMatch = message.from.match(/<([^>]+)>/);
        const fromEmail = emailMatch ? emailMatch[1] : null;
        // Attachment URLs embed the message id as a path segment
        // (/messages/<id>/attachments/<att>), so a collision variant must
        // rewrite that segment. Sanitization baked the base id into htmlBody
        // before this upsert assigned the variant; leaving it stale makes the
        // inline <img> 404 and appendUnreferencedInlineImages tack on a second
        // copy, so the image renders once broken and once correct.
        const baseMessagePathSegment = `/messages/${encodeURIComponent(message.id)}/`;
        const rowMessagePathSegment = `/messages/${encodeURIComponent(rowId)}/`;
        const rewriteAttachmentUrl = (url?: string) => {
          if (!url || rowId === message.id) return url ?? null;
          return url.replaceAll(baseMessagePathSegment, rowMessagePathSegment);
        };
        const rewrittenHtmlBody =
          rowId !== message.id && message.htmlBody
            ? message.htmlBody.replaceAll(baseMessagePathSegment, rowMessagePathSegment)
            : message.htmlBody;
        insertMessage.run(
          rowId,
          message.accountId,
          message.folderId,
          message.threadId,
          message.parentId ?? null,
          message.messageId ?? null,
          message.inReplyTo ?? null,
          message.references ? JSON.stringify(message.references) : null,
          message.xForwardedMessageId ?? null,
          message.xComposeFormat ?? null,
          message.quotedHtmlEdited ? 1 : 0,
          message.subject,
          message.from,
          fromEmail,
          message.replyTo?.trim() || null,
          message.to,
          message.cc ?? null,
          message.bcc ?? null,
          message.mailboxPath ?? null,
          typeof message.imapUid === "number" ? message.imapUid : null,
          message.preview,
          message.date,
          message.dateValue,
          message.body,
          rewrittenHtmlBody ?? null,
          message.priority ?? null,
          message.hasSource ? 1 : 0,
          unread ? 1 : 0,
          message.flags ? JSON.stringify(normalizedFlags) : null,
          seen ? 1 : 0,
          answered ? 1 : 0,
          flagged ? 1 : 0,
          deleted ? 1 : 0,
          draft ? 1 : 0,
          recent ? 1 : 0,
          category,
          categoryScore,
          categorySignals ? JSON.stringify(categorySignals) : null,
          manualCategoryState,
          message.listUnsubscribe ?? null,
          message.listId ?? null,
          sizeBytes
        );
        deleteFts.run(rowId);
        insertFts.run(
          rowId,
          message.subject,
          message.from,
          message.to,
          message.cc ?? "",
          message.bcc ?? "",
          message.body,
          message.preview
        );
        normalizeCalendarEventUids(message.calendarEventUids).forEach((eventUid) => {
          const existing = preservedCalendarInviteStateByUid.get(eventUid);
          insertCalendarEvent.run(
            accountId,
            rowId,
            eventUid,
            existing?.eventUidKey ?? normalizeCalendarEventUidKey(eventUid),
            existing?.eventFirstStartAtMs ?? null,
            existing?.eventLastEndAtMs ?? null,
            existing?.inviteActionType ?? null,
            existing?.processedAtMs ?? null,
            existing?.processedByUserId ?? null,
            typeof existing?.processedAutomatically === "boolean"
              ? (existing.processedAutomatically ? 1 : 0)
              : null,
            existing?.unprocessedReason ?? null,
            existing?.snapshotJson ?? null,
            existing?.snapshotVersion ?? null
          );
        });
        (message.attachments ?? []).forEach((att) => {
          insertAttachment.run(
            att.id,
            rowId,
            att.filename,
            att.contentType,
            att.size,
            att.inline ? 1 : 0,
            att.cid ?? null,
            rewriteAttachmentUrl(att.url) ?? null
          );
        });
      });
    });

    if (replaceExisting) {
      db.transaction(() => {
        deleteAttachmentsByScope.run(...deleteArgs);
        if (folderId) {
          deleteCalendarEventsByScope.run(accountId, accountId, folderId);
        } else {
          deleteCalendarEventsByScope.run(accountId);
        }
        deleteFtsByScope.run(...deleteArgs);
        deleteMessages.run(...deleteArgs);
      })();
    }

    const shouldDeleteAttachments = !replaceExisting;
    for (let start = 0; start < nextMessages.length; start += UPSERT_BATCH_SIZE) {
      const batch = nextMessages.slice(start, start + UPSERT_BATCH_SIZE);
      if (batch.length === 0) continue;
      upsertBatch(batch, shouldDeleteAttachments);
      if (start + UPSERT_BATCH_SIZE < nextMessages.length) {
        await yieldToEventLoop();
      }
    }

    let affectedThreadIds: string[] = [];
    let requiresFullRecompute = false;

    if (replaceExisting) {
      if (folderId) {
        const affectedThreadIdSet = new Set<string>([
          ...(existingScopeThreadIds ?? new Set<string>()),
          ...dedupedThreadIds
        ]);
        nextMessages.forEach((message) => {
          if (message.threadId) {
            affectedThreadIdSet.add(message.threadId);
          }
        });
        const affected = Array.from(affectedThreadIdSet);
        if (shouldRecomputeThreads && affected.length > 0) {
          await recomputeThreadsForAccountInternal(accountId, affected);
        }
        await rebuildThreadSignalsForThreadIds(db, accountId, affected);
        upsertTopicLearningSignalsForThreadIds(db, accountId, affected);
        pruneThreadTopicsWithoutMessages(db, accountId, affected);
        return { affectedThreadIds: affected, requiresFullRecompute };
      }
      requiresFullRecompute = true;
      if (shouldRecomputeThreads) {
        await recomputeThreadsForAccountInternal(accountId);
      }
      await rebuildAllThreadSignalsForAccount(db, accountId);
      const learningThreadIds = [
        ...(existingAccountThreadIds ?? new Set<string>()),
        ...nextMessages.map((message) => message.threadId).filter(Boolean)
      ];
      upsertTopicLearningSignalsForThreadIds(db, accountId, learningThreadIds);
      pruneThreadTopicsWithoutMessages(db, accountId, [
        ...(existingAccountThreadIds ?? new Set<string>()),
        ...nextMessages.map((message) => message.threadId).filter(Boolean)
      ]);
    } else {
      const affected = Array.from(
        new Set([
          ...nextMessages.map((message) => message.threadId).filter(Boolean),
          ...dedupedThreadIds
        ])
      );
      affectedThreadIds = affected;
      if (shouldRecomputeThreads && affected.length > 0) {
        await recomputeThreadsForAccountInternal(accountId, affected);
      }
      await rebuildThreadSignalsForThreadIds(db, accountId, affected);
      upsertTopicLearningSignalsForThreadIds(db, accountId, affected);
      pruneThreadTopicsWithoutMessages(db, accountId, affected);
    }
    return { affectedThreadIds, requiresFullRecompute };
  });
}
