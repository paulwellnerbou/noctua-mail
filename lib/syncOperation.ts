import {
  deleteMessagesByIds,
  deleteMessagesWithFilesByIds,
  getAccounts,
  getFolderIdsByMessageIds,
  listMessageFileRefs,
  listFolderMessageUidRows,
  recomputeCategoriesForAccount,
  recomputeThreadsForAccount,
  getMessageIdsByMessageIds,
  getThreadIdsByMessageIds,
  saveFoldersForAccount,
  saveMailboxState,
  upsertMessages
} from "@/lib/db";
import { processCalendarInviteForMessage } from "@/lib/calendarInviteProcessor";
import { getAttachmentContentBuffer, sanitizeSyncedMessage } from "@/lib/mail/syncMessageSanitizer";
import { isCalendarAttachment } from "@/lib/messageFlags";
import { extractPrimaryEmail, normalizeEmailAddress } from "@/lib/senderIdentity";
import { deleteMessageFiles } from "@/lib/storage";
import { listImapMailboxUids, syncImapAccountBatched } from "@/lib/mail/imap";
import { reconcileVerifiedCrossFolderMoves } from "@/lib/syncMoveReconciliation";
import { collectThreadReferenceIds, resolveThreadingForItems } from "@/lib/threading";

export type SyncMode = "full" | "recent" | "new" | "repair";

export type SyncPayload = {
  accountId: string;
  folderId?: string;
  fullSync?: boolean;
  mode?: SyncMode;
  recategorizeFolder?: boolean;
  /** UID of the last successfully processed message from a previous attempt; sync resumes from the next UID. */
  resumeFromUid?: number;
};

export type SyncNotificationMessage = {
  folderId: string;
  uid: number;
  subject: string;
  from: string;
  messageId?: string | null;
  category?: string | null;
};

export type SyncOperationResult = {
  count: number;
  newMessages?: SyncNotificationMessage[];
  /** Highest IMAP UID successfully written to DB; used for resume on retry. */
  highestProcessedUid?: number;
};

export type SyncOperationProgressPhase =
  | "starting"
  | "fetching"
  | "finalizing"
  | "done"
  | "failed"
  | "retrying";

export type SyncOperationProgress = {
  accountId: string;
  folderId?: string;
  mailboxPath: string;
  mode: SyncMode;
  phase: SyncOperationProgressPhase;
  processed: number;
  batchNumber?: number;
  batchSize?: number;
  estimatedTotal?: number;
  percent?: number;
  message?: string;
  retryAttempt?: number;
  maxRetries?: number;
  /** Highest IMAP UID committed to DB so far; emitted after each successful batch write. */
  highestProcessedUid?: number;
  updatedAt: number;
};

export type SyncOperationOptions = {
  onProgress?: (progress: SyncOperationProgress) => void;
};

export function diffLocalAndRemoteFolderUids(
  localRows: Array<{ id: string; imapUid: number }>,
  remoteUids: number[]
) {
  const remoteUidSet = new Set(remoteUids.filter((uid) => Number.isFinite(uid) && uid > 0));
  const staleMessageIds = localRows
    .filter((row) => !remoteUidSet.has(row.imapUid))
    .map((row) => row.id);
  const localUidSet = new Set(localRows.map((row) => row.imapUid));
  const missingRemoteUids = remoteUids.filter((uid) => !localUidSet.has(uid));
  return {
    staleMessageIds,
    missingRemoteUids
  };
}

const GOOGLE_CALENDAR_SYNC_SENDER = "noreply-calendar-sync@google.com";

function extractMessageHeaderSection(source?: string | null) {
  if (!source) return "";
  const separatorMatch = source.match(/\r?\n\r?\n/);
  if (!separatorMatch || typeof separatorMatch.index !== "number") {
    return source;
  }
  return source.slice(0, separatorMatch.index);
}

export function isGoogleCalendarSyncMessage(params: {
  from?: string | null;
  fromEmail?: string | null;
  source?: string | null;
}) {
  const directFromEmail =
    normalizeEmailAddress(params.fromEmail) ?? extractPrimaryEmail(params.from) ?? null;
  if (directFromEmail === GOOGLE_CALENDAR_SYNC_SENDER) {
    return true;
  }
  const headerSection = extractMessageHeaderSection(params.source).toLowerCase();
  if (!headerSection) return false;
  return headerSection.includes(GOOGLE_CALENDAR_SYNC_SENDER);
}

export function shouldAutoProcessCalendarInviteMessage(params: {
  from?: string | null;
  fromEmail?: string | null;
  source?: string | null;
}) {
  return !isGoogleCalendarSyncMessage(params);
}

export function resolveOrphanedMessageFileRefs(params: {
  removed: Array<{ messageId: string; attachmentIds: string[] }>;
  existingFolderIds: Map<string, string>;
  currentFolderId?: string | null;
}) {
  const { removed, existingFolderIds, currentFolderId = null } = params;
  if (removed.length === 0) return [];
  if (!currentFolderId) return removed;
  return removed.filter((item) => {
    const existingFolderId = existingFolderIds.get(item.messageId);
    if (!existingFolderId) return true;
    return existingFolderId === currentFolderId;
  });
}

export async function runSyncOperation(
  payload: SyncPayload,
  clientId?: string,
  options?: SyncOperationOptions
): Promise<SyncOperationResult> {
  // Use batched version by default for better memory efficiency
  // This reduces peak memory usage by 80-90% for large folders
  return runSyncOperationBatched(payload, clientId, options);
}

/**
 * Batched version of runSyncOperation that processes messages in chunks
 * to reduce memory usage during large folder syncs.
 *
 * Key improvements over the original:
 * - Processes messages in batches of 100 instead of loading all into memory
 * - Writes to database incrementally instead of one bulk write
 * - Reduces peak memory usage by ~80-90% for large folders
 */
export async function runSyncOperationBatched(
  payload: SyncPayload,
  clientId?: string,
  options?: SyncOperationOptions
): Promise<SyncOperationResult> {
  const accounts = await getAccounts();
  const account = accounts.find((item) => item.id === payload.accountId);

  if (!account) {
    throw new Error("Account not found");
  }

  const mailboxPath = payload.folderId
    ? payload.folderId.replace(`${account.id}:`, "")
    : undefined;
  const resolvedMailboxPath = mailboxPath ?? "INBOX";
  const syncMode = payload.mode ?? (payload.fullSync ? "full" : "recent");
  const emitProgress = (
    progress: Omit<
      SyncOperationProgress,
      "accountId" | "folderId" | "mailboxPath" | "mode" | "updatedAt"
    > &
      Pick<SyncOperationProgress, "phase">
  ) => {
    options?.onProgress?.({
      accountId: account.id,
      folderId: payload.folderId,
      mailboxPath: resolvedMailboxPath,
      mode: syncMode,
      ...progress,
      updatedAt: Date.now()
    });
  };
  const calculatePercent = (processed: number, estimatedTotal?: number) => {
    if (typeof estimatedTotal !== "number" || !Number.isFinite(estimatedTotal)) return undefined;
    if (estimatedTotal <= 0) return 100;
    return Math.min(100, Math.round((Math.max(0, processed) / estimatedTotal) * 1000) / 10);
  };

  const yieldToEventLoop = () =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

  // Track state across batches
  let totalCount = 0;
  let folders: any[] = [];
  const allProcessedIds = new Set<string>();
  const resolvedThreadIds = new Map<string, string>();
  const resolvedParentIds = new Map<string, string>();
  const newNotificationMessages: SyncNotificationMessage[] = [];
  const calendarInviteImports: Array<{ messageId: string; icsSource: string; process: boolean }> =
    [];
  let latestEstimatedTotal: number | undefined;
  // Highest IMAP UID successfully written to DB — updated after each batch upsert.
  let highestProcessedUid: number | undefined = payload.resumeFromUid;

  emitProgress({
    phase: "starting",
    processed: 0,
    message: "Starting sync."
  });

  if (syncMode === "repair") {
    if (!payload.folderId || !mailboxPath) {
      throw new Error("Repair sync requires a folderId.");
    }

    emitProgress({
      phase: "fetching",
      processed: 0,
      message: "Reconciling folder changes."
    });

    const [remoteSnapshot, localRows] = await Promise.all([
      listImapMailboxUids(account, mailboxPath, clientId),
      listFolderMessageUidRows(account.id, payload.folderId)
    ]);

    const { staleMessageIds, missingRemoteUids } = diffLocalAndRemoteFolderUids(
      localRows.map((row) => ({ id: row.id, imapUid: row.imapUid })),
      remoteSnapshot.uids
    );
    const highestLocalUid =
      localRows.length > 0 ? Math.max(...localRows.map((row) => row.imapUid)) : null;
    const hasHistoricalRemoteGaps =
      highestLocalUid !== null && missingRemoteUids.some((uid) => uid <= highestLocalUid);

    if (staleMessageIds.length > 0) {
      await deleteMessagesWithFilesByIds(account.id, staleMessageIds);
    }

    if (hasHistoricalRemoteGaps) {
      return runSyncOperationBatched(
        {
          ...payload,
          mode: "full",
          fullSync: true,
          resumeFromUid: undefined
        },
        clientId,
        options
      );
    }

    const persistRepairMailboxState = async () => {
      await saveMailboxState({
        accountId: account.id,
        folderId: payload.folderId!,
        mailboxPath,
        uidValidity: remoteSnapshot.uidValidity,
        highestModSeq: remoteSnapshot.highestModSeq,
        highestUid: remoteSnapshot.highestUid,
        supportsQresync: remoteSnapshot.supportsQresync
      });
    };

    if (missingRemoteUids.length > 0) {
      const nestedResult = await runSyncOperationBatched(
        {
          ...payload,
          mode: "new",
          fullSync: false,
          resumeFromUid: undefined
        },
        clientId,
        options
      );
      await persistRepairMailboxState();
      return {
        count: staleMessageIds.length + nestedResult.count,
        newMessages: nestedResult.newMessages,
        highestProcessedUid: nestedResult.highestProcessedUid
      };
    }

    await saveFoldersForAccount(account.id, remoteSnapshot.folders);
    await persistRepairMailboxState();
    const result = {
      count: staleMessageIds.length,
      highestProcessedUid: remoteSnapshot.highestUid ?? undefined
    };
    emitProgress({
      phase: "done",
      processed: result.count,
      estimatedTotal: localRows.length,
      percent: 100,
      highestProcessedUid: result.highestProcessedUid,
      message: "Repair completed."
    });
    return result;
  }

  // A fresh full sync (no resume) captures existing message IDs upfront so we
  // can reconcile orphans (messages deleted from the server) at the end.
  // Resumed syncs skip reconciliation because we only re-fetch a subset of UIDs.
  const isFreshFullSync = syncMode === "full" && !payload.resumeFromUid;
  const existingFileRefs = isFreshFullSync
    ? await listMessageFileRefs(account.id, payload.folderId ?? null)
    : [];

  // Process each batch as it arrives from IMAP
  for await (const batch of syncImapAccountBatched(account, mailboxPath, syncMode, clientId, 300, {
    resumeFromUid: payload.resumeFromUid
  })) {
    folders = batch.folders; // Keep latest folder list
    const batchMessages = batch.messages;
    totalCount = batch.totalProcessed;
    if (typeof batch.estimatedTotal === "number" && Number.isFinite(batch.estimatedTotal)) {
      latestEstimatedTotal = batch.estimatedTotal;
    }

    emitProgress({
      phase: "fetching",
      processed: totalCount,
      batchNumber: batch.batchNumber,
      batchSize: batchMessages.length,
      estimatedTotal: latestEstimatedTotal,
      percent: calculatePercent(totalCount, latestEstimatedTotal),
      message: "Fetched message batch."
    });

    if (batchMessages.length === 0) continue;

    // Collect reference IDs from this batch — only query DB for refs not already resolved
    const batchRefs = collectThreadReferenceIds(batchMessages);
    const unresolvedRefs = batchRefs.filter(
      (id) => !resolvedThreadIds.has(id) && !resolvedParentIds.has(id)
    );

    if (unresolvedRefs.length > 0) {
      const newThreadIds = await getThreadIdsByMessageIds(account.id, unresolvedRefs);
      const newParentIds = await getMessageIdsByMessageIds(account.id, unresolvedRefs);
      newThreadIds.forEach((v, k) => resolvedThreadIds.set(k, v));
      newParentIds.forEach((v, k) => resolvedParentIds.set(k, v));
    }
    const externalThreadIds = resolvedThreadIds;
    const externalParentIds = resolvedParentIds;

    // Normalize threading for this batch
    const normalizedMessages = resolveThreadingForItems(batchMessages, {
      externalThreadIds,
      externalParentIds
    });

    // Sanitize messages in sub-batches of 50
    const SANITIZE_BATCH_SIZE = 50;
    const sanitizedMessages: Array<Awaited<ReturnType<typeof sanitizeSyncedMessage>>> = [];
    for (let start = 0; start < normalizedMessages.length; start += SANITIZE_BATCH_SIZE) {
      const subBatch = normalizedMessages.slice(start, start + SANITIZE_BATCH_SIZE);
      const sanitizedBatch = await Promise.all(
        subBatch.map((message) => sanitizeSyncedMessage(message, account.id))
      );
      sanitizedMessages.push(...sanitizedBatch);
      if (start + SANITIZE_BATCH_SIZE < normalizedMessages.length) {
        await yieldToEventLoop();
      }
    }

    // Keep all synced messages here and let DB upsert decide how to resolve
    // conflicting internal IDs. Pre-filtering by existing ID in another folder
    // drops legitimate cross-folder copies (e.g. self-sent mail in Sent+INBOX).
    const strippedMessages = sanitizedMessages;

    // Another client may have moved a message to this folder, leaving our local
    // row behind in the previous mailbox. Verify those cross-folder collisions
    // against IMAP and only relocate rows whose old UID no longer exists.
    await reconcileVerifiedCrossFolderMoves(account, strippedMessages, clientId);

    // Write this batch to database.
    // Never delete existing messages upfront — we upsert incrementally so
    // messages remain visible throughout the sync. Orphan reconciliation
    // (deleting server-removed messages) happens at the end of a fresh full sync.
    await upsertMessages(
      account.id,
      payload.folderId ?? null,
      strippedMessages,
      false,
      { recomputeThreads: true }
    );

    // Track processed IDs and highest UID for orphan cleanup and resume support.
    for (const msg of strippedMessages) {
      allProcessedIds.add(msg.id);
      if (typeof msg.imapUid === "number" && msg.imapUid > 0) {
        if (highestProcessedUid === undefined || msg.imapUid > highestProcessedUid) {
          highestProcessedUid = msg.imapUid;
        }
      }
    }

    // Emit progress after the batch is committed so the retry loop can capture
    // highestProcessedUid even if the next fetch throws.
    emitProgress({
      phase: "fetching",
      processed: totalCount,
      batchNumber: batch.batchNumber,
      batchSize: strippedMessages.length,
      estimatedTotal: latestEstimatedTotal,
      percent: calculatePercent(totalCount, latestEstimatedTotal),
      highestProcessedUid,
      message: "Batch written to database."
    });

    // Collect ICS sources for calendar event import (all sync modes — upsert is idempotent)
    if (strippedMessages.length > 0) {
      const strippedIds = new Set(strippedMessages.map((item) => item.id));
      const syncedMessages = normalizedMessages.filter((message) => strippedIds.has(message.id));

      syncedMessages.forEach((message) => {
        const shouldProcessInvite =
          syncMode === "new" &&
          shouldAutoProcessCalendarInviteMessage({
            from: message.from,
            fromEmail: message.fromEmail,
            source: message.source
          });
        (message.attachments ?? []).forEach((attachment) => {
          if (!isCalendarAttachment(attachment)) return;
          const attachmentBuffer = getAttachmentContentBuffer(attachment);
          if (!attachmentBuffer) return;
          const icsSource = attachmentBuffer.toString("utf8");
          calendarInviteImports.push({
            messageId: message.id,
            icsSource,
            process: shouldProcessInvite
          });
        });
      });

      // Collect new message notifications (new mode only)
      if (syncMode === "new") {
        strippedMessages.forEach((message) => {
          if (typeof message.imapUid !== "number") return;
          newNotificationMessages.push({
            folderId: message.folderId,
            uid: message.imapUid,
            subject: message.subject,
            from: message.from,
            messageId: message.messageId ?? null,
            category: message.category ?? null
          });
        });
      }
    }

    // Clear batch from memory before next iteration
    // (TypeScript/JS GC will handle this, but makes intent clear)
  }

  emitProgress({
    phase: "finalizing",
    processed: totalCount,
    estimatedTotal: latestEstimatedTotal,
    percent: calculatePercent(totalCount, latestEstimatedTotal),
    message: "Applying synchronized changes."
  });

  for (const invite of calendarInviteImports) {
    await processCalendarInviteForMessage({
      accountId: account.id,
      messageId: invite.messageId,
      icsSource: invite.icsSource,
      process: invite.process,
      accountEmail: account.email,
      reminderUserId: syncMode === "new" ? account.ownerUserId : undefined,
      processedByUserId: syncMode === "new" ? account.ownerUserId : undefined
    });
  }

  if (payload.fullSync && totalCount > 0) {
    // Final full recompute fixes cross-batch thread assignments (e.g. a reply
    // arriving in an earlier batch than its parent). Per-batch recomputes above
    // already made messages visible; this pass ensures thread roots are correct.
    await recomputeThreadsForAccount(account.id);
  }

  // Reconcile orphaned messages for fresh full syncs.
  // existingFileRefs captured all message IDs (via LEFT JOIN) before this sync
  // started. Any ID not seen during this sync was deleted from the server.
  if (isFreshFullSync && existingFileRefs.length > 0) {
    const removed = existingFileRefs.filter((item) => !allProcessedIds.has(item.messageId));
    if (removed.length > 0) {
      // Guard: skip rows that were relocated to another folder during sync.
      // Rows still present in the current folder are stale and must be deleted.
      const existingFolderIds = await getFolderIdsByMessageIds(
        account.id,
        removed.map((item) => item.messageId)
      );
      const orphaned = resolveOrphanedMessageFileRefs({
        removed,
        existingFolderIds,
        currentFolderId: payload.folderId ?? null
      });
      if (orphaned.length > 0) {
        // Delete stored attachment files first, then purge DB records.
        await Promise.all(
          orphaned.map((item) =>
            deleteMessageFiles(account.id, item.messageId, item.attachmentIds)
          )
        );
        await deleteMessagesByIds(
          account.id,
          orphaned.map((item) => item.messageId)
        );
      }
    }
  }

  // Save folders
  await saveFoldersForAccount(account.id, folders);

  if (payload.recategorizeFolder && payload.folderId) {
    emitProgress({
      phase: "finalizing",
      processed: totalCount,
      estimatedTotal: latestEstimatedTotal,
      percent: calculatePercent(totalCount, latestEstimatedTotal),
      message: "Recomputing categories for synced folder."
    });
    await recomputeCategoriesForAccount(account.id, { folderId: payload.folderId });
  }

  const result = {
    count: totalCount,
    newMessages: syncMode === "new" ? newNotificationMessages : undefined,
    highestProcessedUid
  };
  emitProgress({
    phase: "done",
    processed: result.count,
    estimatedTotal: latestEstimatedTotal,
    percent: calculatePercent(result.count, latestEstimatedTotal),
    message: "Sync completed."
  });

  return result;
}
