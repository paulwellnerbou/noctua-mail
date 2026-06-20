import {
  bulkUpdateMessageFlags,
  deleteMessagesByIds,
  deleteMessagesWithFilesByIds,
  getAccounts,
  getFolderIdsByMessageIds,
  listFullyProcessedCalendarInviteMessageIds,
  listMessageFileRefs,
  listFolderMessageUidAndFlagRows,
  getPendingMoveSourceUids,
  recomputeCategoriesForAccount,
  recomputeThreadsForAccount,
  getMessageIdsByMessageIds,
  getThreadIdsByMessageIds,
  getTombstonedDraftMessageIds,
  saveFoldersForAccount,
  saveMailboxState,
  updateMailboxHighestUid,
  upsertMessages
} from "@/lib/db";
import { processCalendarInviteForMessage } from "@/lib/calendarInviteProcessor";
import { getAttachmentContentBuffer, sanitizeSyncedMessage } from "@/lib/mail/syncMessageSanitizer";
import { hasMessageFlag, isCalendarAttachment, CALENDAR_INVITE_FLAG } from "@/lib/messageFlags";
import type { SyncMode } from "@/lib/syncPolicy";
import { deleteMessageFiles } from "@/lib/storage";
import {
  deleteImapMessage,
  listImapMailboxUidsAndFlags,
  syncImapAccountBatched
} from "@/lib/mail/imap";
import { reconcileVerifiedCrossFolderMoves } from "@/lib/syncMoveReconciliation";
import { collectThreadReferenceIds, resolveThreadingForItems } from "@/lib/threading";

// Public types and progress helpers live in `lib/syncOperation/` siblings;
// we re-export the types here so existing `@/lib/syncOperation` callers
// keep compiling without edits. See `CLEANUP/pass3-architecture.md` P2-9.
import {
  calculateProgressPercent,
  createSyncProgressTracker
} from "./syncOperation/progress";
export type {
  SyncMode,
  SyncNotificationMessage,
  SyncOperationOptions,
  SyncOperationProgress,
  SyncOperationProgressPhase,
  SyncOperationResult,
  SyncPayload
} from "./syncOperation/types";
import type {
  SyncNotificationMessage,
  SyncOperationOptions,
  SyncOperationProgress,
  SyncOperationResult,
  SyncPayload
} from "./syncOperation/types";

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

// App-local flags that are added during message parsing and not stored on IMAP.
// Exclude from flag comparison to avoid spurious updates.
const APP_LOCAL_FLAGS = new Set([CALENDAR_INVITE_FLAG.toLowerCase()]);
// Session-specific IMAP flag — always differs between sessions.
const VOLATILE_FLAGS = new Set(["\\recent"]);

function normalizeForFlagComparison(flags: string[]): string {
  return flags
    .map((f) => f.toLowerCase())
    .filter((f) => !APP_LOCAL_FLAGS.has(f) && !VOLATILE_FLAGS.has(f))
    .sort()
    .join(",");
}

export function diffLocalAndRemoteWithFlags(
  localRows: Array<{ id: string; imapUid: number; flags: string | null }>,
  remoteEntries: Array<{ uid: number; flags: string[] }>
) {
  const remoteByUid = new Map(remoteEntries.map((e) => [e.uid, e]));
  const localByUid = new Map(localRows.map((r) => [r.imapUid, r]));

  const staleMessageIds = localRows
    .filter((row) => !remoteByUid.has(row.imapUid))
    .map((row) => row.id);

  const missingRemoteUids = remoteEntries
    .filter((e) => !localByUid.has(e.uid))
    .map((e) => e.uid);

  const flagUpdates: Array<{ id: string; flags: string[] }> = [];
  for (const [uid, remote] of remoteByUid) {
    const local = localByUid.get(uid);
    if (!local) continue;
    let localFlags: string[] = [];
    if (local.flags) {
      try {
        const parsed = JSON.parse(local.flags);
        if (Array.isArray(parsed)) localFlags = parsed;
      } catch {
        // Malformed flags JSON — treat as empty; the remote flags will overwrite.
      }
    }
    const localNorm = normalizeForFlagComparison(localFlags);
    const remoteNorm = normalizeForFlagComparison(remote.flags);
    if (localNorm !== remoteNorm) {
      // Merge remote IMAP flags with any app-local flags the local row has,
      // so we don't lose app-specific flags like calendar-invite.
      const appLocalFlags = localFlags.filter((f) => APP_LOCAL_FLAGS.has(f.toLowerCase()));
      flagUpdates.push({ id: local.id, flags: [...remote.flags, ...appLocalFlags] });
    }
  }

  return { staleMessageIds, missingRemoteUids, flagUpdates };
}

export function filterMissingRemoteUidsForPendingMoves(
  missingRemoteUids: number[],
  pendingMoveSourceUids: Set<number>
) {
  if (pendingMoveSourceUids.size === 0) return missingRemoteUids;
  return missingRemoteUids.filter((uid) => !pendingMoveSourceUids.has(uid));
}

export function partitionMissingRemoteUids(
  missingRemoteUids: number[],
  highestLocalUid: number | null
) {
  const normalized = Array.from(
    new Set(missingRemoteUids.filter((uid) => Number.isFinite(uid) && uid > 0))
  ).sort((left, right) => left - right);
  if (highestLocalUid === null) {
    return {
      historicalMissingUids: [] as number[],
      newerMissingUids: normalized,
      backfillUids: normalized
    };
  }
  const historicalMissingUids = normalized.filter((uid) => uid <= highestLocalUid);
  const newerMissingUids = normalized.filter((uid) => uid > highestLocalUid);
  return {
    historicalMissingUids,
    newerMissingUids,
    backfillUids: normalized
  };
}

export function planTwoPhaseNewBackfill(
  missingRemoteUids: number[],
  highestLocalUid: number | null
) {
  const { historicalMissingUids, newerMissingUids, backfillUids } =
    partitionMissingRemoteUids(missingRemoteUids, highestLocalUid);
  const requiresExplicitBackfill =
    highestLocalUid === null || historicalMissingUids.length > 0;

  return {
    historicalMissingUids,
    newerMissingUids,
    backfillUids: requiresExplicitBackfill ? backfillUids : [],
    requiresExplicitBackfill
  };
}

type CalendarInviteImport = {
  messageId: string;
  icsSource: string;
  dateValue: number;
  imapUid?: number;
  process: boolean;
  importOrder: number;
};

export function shouldAutoProcessCalendarInvitesForSyncMode(syncMode: SyncMode) {
  return syncMode === "new" || syncMode === "recent";
}

export function sortCalendarInviteImportsForProcessing(invites: CalendarInviteImport[]) {
  return invites.slice().sort((left, right) => {
    const leftDate = Number.isFinite(left.dateValue) ? left.dateValue : Number.MAX_SAFE_INTEGER;
    const rightDate = Number.isFinite(right.dateValue) ? right.dateValue : Number.MAX_SAFE_INTEGER;
    if (leftDate !== rightDate) return leftDate - rightDate;
    const leftUid =
      typeof left.imapUid === "number" && Number.isFinite(left.imapUid)
        ? left.imapUid
        : Number.MAX_SAFE_INTEGER;
    const rightUid =
      typeof right.imapUid === "number" && Number.isFinite(right.imapUid)
        ? right.imapUid
        : Number.MAX_SAFE_INTEGER;
    if (leftUid !== rightUid) return leftUid - rightUid;
    if (left.messageId !== right.messageId) return left.messageId.localeCompare(right.messageId);
    return left.importOrder - right.importOrder;
  });
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
  // Tracker holds the per-sync context and stamps it onto every progress
  // event. See `lib/syncOperation/progress.ts` for the extracted logic.
  const { emit: emitProgress } = createSyncProgressTracker(
    {
      accountId: account.id,
      folderId: payload.folderId,
      mailboxPath: resolvedMailboxPath,
      mode: syncMode
    },
    options
  );
  // Local alias so the ~6 call sites below don't need touching.
  const calculatePercent = calculateProgressPercent;

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
  const calendarInviteImports: CalendarInviteImport[] = [];
  let calendarInviteImportOrder = 0;
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

    // Fetch UIDs + flags (not just UIDs) so repair also detects flag changes.
    const [remoteSnapshot, localRows] = await Promise.all([
      listImapMailboxUidsAndFlags(account, mailboxPath, "1:*", clientId),
      listFolderMessageUidAndFlagRows(account.id, payload.folderId)
    ]);

    const repairDiff = diffLocalAndRemoteWithFlags(localRows, remoteSnapshot.entries);

    // Exclude UIDs queued for move out of this folder (same reason as two-phase sync).
    const repairPendingMoveUids = await getPendingMoveSourceUids(account.id, payload.folderId);
    const missingRemoteUids = filterMissingRemoteUidsForPendingMoves(
      repairDiff.missingRemoteUids,
      repairPendingMoveUids
    );
    const { staleMessageIds, flagUpdates } = repairDiff;

    const highestLocalUid =
      localRows.length > 0 ? Math.max(...localRows.map((row) => row.imapUid)) : null;
    const { historicalMissingUids, newerMissingUids, backfillUids } =
      partitionMissingRemoteUids(missingRemoteUids, highestLocalUid);

    if (staleMessageIds.length > 0) {
      await deleteMessagesWithFilesByIds(account.id, staleMessageIds);
    }

    // Update flags for existing messages where they differ.
    if (flagUpdates.length > 0) {
      await bulkUpdateMessageFlags(account.id, flagUpdates);
    }

    if (historicalMissingUids.length > 0) {
      console.info("[noctua][sync] repair backfilling historical UID gaps", {
        accountId: account.id,
        folderId: payload.folderId,
        mailboxPath,
        highestLocalUid,
        historicalMissingUidsSample: historicalMissingUids.slice(0, 20),
        newerMissingUidsSample: newerMissingUids.slice(0, 20),
        backfillCount: backfillUids.length
      });
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

    if (backfillUids.length > 0) {
      const nestedResult = await runSyncOperationBatched(
        {
          ...payload,
          mode: "new",
          fullSync: false,
          resumeFromUid: undefined,
          backfillUids
        },
        clientId,
        options
      );
      await persistRepairMailboxState();
      return {
        count: staleMessageIds.length + flagUpdates.length + nestedResult.count,
        newMessages: nestedResult.newMessages,
        highestProcessedUid: nestedResult.highestProcessedUid
      };
    }

    await saveFoldersForAccount(account.id, remoteSnapshot.folders);
    await persistRepairMailboxState();
    const repairCount = staleMessageIds.length + flagUpdates.length;
    const result = {
      count: repairCount,
      highestProcessedUid: remoteSnapshot.highestUid ?? undefined
    };
    emitProgress({
      phase: "done",
      processed: result.count,
      estimatedTotal: localRows.length,
      percent: 100,
      highestProcessedUid: result.highestProcessedUid,
      message: `Repair completed: ${staleMessageIds.length} removed, ${flagUpdates.length} flag updates, ${backfillUids.length} backfilled.`
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Two-phase sync for recent/full: lightweight UID+flag diff first, then
  // only fetch full message source for genuinely new UIDs.
  // This avoids re-downloading message bodies that are already stored locally.
  // ---------------------------------------------------------------------------
  const useTwoPhaseSync =
    (syncMode === "recent" || (syncMode === "full" && !payload.resumeFromUid)) &&
    payload.folderId &&
    mailboxPath;

  if (useTwoPhaseSync) {
    const twoPhaseFolderId = payload.folderId!;
    const twoPhaseMailboxPath = mailboxPath!;

    emitProgress({
      phase: "fetching",
      processed: 0,
      message: "Checking for changes (lightweight)."
    });

    const searchCriteria =
      syncMode === "full"
        ? "1:*"
        : { since: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) };

    const snapshot = await listImapMailboxUidsAndFlags(
      account,
      twoPhaseMailboxPath,
      searchCriteria,
      clientId
    );
    folders = snapshot.folders;

    const localRows = await listFolderMessageUidAndFlagRows(account.id, twoPhaseFolderId);
    const diff = diffLocalAndRemoteWithFlags(localRows, snapshot.entries);

    // Exclude UIDs that are queued for move out of this folder. These messages
    // are still on the IMAP server (the async IMAP move hasn't run yet) but no
    // longer associated with this folder in the local DB. Without this filter,
    // the sync would re-download them as "new" messages, causing them to
    // briefly reappear in the message list after deletion/move.
    const pendingMoveUids = await getPendingMoveSourceUids(account.id, twoPhaseFolderId);
    const missingRemoteUids = filterMissingRemoteUidsForPendingMoves(
      diff.missingRemoteUids,
      pendingMoveUids
    );
    const { staleMessageIds, flagUpdates } = diff;

    // For full sync, delete messages that no longer exist on the server.
    // For recent sync, we can't distinguish "old" from "deleted" since we
    // only see a 30-day window, so skip deletion.
    if (syncMode === "full" && staleMessageIds.length > 0) {
      await deleteMessagesWithFilesByIds(account.id, staleMessageIds);
    }

    // Update flags for existing messages where they differ.
    if (flagUpdates.length > 0) {
      await bulkUpdateMessageFlags(account.id, flagUpdates);
    }

    // Persist mailbox state so subsequent "new" mode resolves the correct range.
    await saveMailboxState({
      accountId: account.id,
      folderId: twoPhaseFolderId,
      mailboxPath: twoPhaseMailboxPath,
      uidValidity: snapshot.uidValidity,
      highestModSeq: snapshot.highestModSeq,
      highestUid: snapshot.highestUid,
      supportsQresync: snapshot.supportsQresync
    });

    // For recent mode, staleMessageIds is inflated (all local messages outside the
    // 30-day window appear "stale") but nothing is actually deleted. Only count
    // real work in progress.
    const effectiveStaleCount = syncMode === "full" ? staleMessageIds.length : 0;
    const phaseOneCount = effectiveStaleCount + flagUpdates.length;

    emitProgress({
      phase: "fetching",
      processed: phaseOneCount,
      message: `Lightweight check done: ${effectiveStaleCount} removed, ${flagUpdates.length} flag updates, ${missingRemoteUids.length} new.`
    });

    if (missingRemoteUids.length === 0) {
      // No new messages — we're done.
      await saveFoldersForAccount(account.id, folders);

      if (payload.recategorizeFolder) {
        await recomputeCategoriesForAccount(account.id, { folderId: twoPhaseFolderId });
      }

      const result: SyncOperationResult = {
        count: phaseOneCount,
        highestProcessedUid: snapshot.highestUid ?? undefined
      };
      emitProgress({
        phase: "done",
        processed: result.count,
        percent: 100,
        highestProcessedUid: result.highestProcessedUid,
        message: "Sync completed (no new messages to download)."
      });
      return result;
    }

    // Phase 2: Fetch full source only for genuinely missing messages via "new"
    // mode. When the local folder has no watermark yet, or there are UID gaps
    // below the current watermark, switch to explicit UID backfill so nested
    // "new" mode does not baseline and skip the missing rows.
    const highestLocalUid =
      localRows.length > 0 ? Math.max(...localRows.map((row) => row.imapUid)) : null;
    const {
      historicalMissingUids,
      backfillUids,
      requiresExplicitBackfill
    } = planTwoPhaseNewBackfill(missingRemoteUids, highestLocalUid);

    if (requiresExplicitBackfill) {
      console.info("[noctua][sync] two-phase using targeted UID backfill", {
        accountId: account.id,
        folderId: twoPhaseFolderId,
        highestLocalUid,
        backfillCount: backfillUids.length,
        historicalGapCount: historicalMissingUids.length
      });
    }

    const nestedResult = await runSyncOperationBatched(
      {
        ...payload,
        mode: "new",
        fullSync: false,
        resumeFromUid: undefined,
        backfillUids: requiresExplicitBackfill ? backfillUids : undefined
      },
      clientId,
      options
    );

    await saveFoldersForAccount(account.id, folders);

    if (syncMode === "full" && (phaseOneCount + nestedResult.count) > 0) {
      await recomputeThreadsForAccount(account.id);
    }
    if (payload.recategorizeFolder) {
      await recomputeCategoriesForAccount(account.id, { folderId: twoPhaseFolderId });
    }

    const result: SyncOperationResult = {
      count: phaseOneCount + nestedResult.count,
      newMessages: nestedResult.newMessages,
      highestProcessedUid: nestedResult.highestProcessedUid ?? snapshot.highestUid ?? undefined
    };
    emitProgress({
      phase: "done",
      processed: result.count,
      percent: 100,
      highestProcessedUid: result.highestProcessedUid,
      message: "Two-phase sync completed."
    });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Legacy full-source fetch path: used for resumed full syncs.
  // ---------------------------------------------------------------------------

  // A fresh full sync (no resume) captures existing message IDs upfront so we
  // can reconcile orphans (messages deleted from the server) at the end.
  // Resumed syncs skip reconciliation because we only re-fetch a subset of UIDs.
  const isFreshFullSync = syncMode === "full" && !payload.resumeFromUid;
  const existingFileRefs = isFreshFullSync
    ? await listMessageFileRefs(account.id, payload.folderId ?? null)
    : [];

  // Process each batch as it arrives from IMAP
  for await (const batch of syncImapAccountBatched(account, mailboxPath, syncMode, clientId, 300, {
    resumeFromUid: payload.resumeFromUid,
    explicitUids: payload.backfillUids
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

    // Drop drafts the user already sent or discarded locally. Their IMAP copy
    // can linger — a delete that raced an in-flight APPEND, a delete that
    // failed, or another client lagging — and without this guard the next
    // sync would re-import the orphan and the draft would reappear in the
    // list next to the message that was sent. Enforcement is keyed on the
    // stable Message-Id (a draft's row id churns across re-saves) and scoped
    // to `\Draft`-flagged messages so a Sent copy that shares the same
    // Message-Id is never affected.
    let messagesToUpsert = strippedMessages;
    const draftCandidates = strippedMessages.filter((msg) => hasMessageFlag(msg.flags, "\\Draft"));
    if (draftCandidates.length > 0) {
      const tombstoned = await getTombstonedDraftMessageIds(
        account.id,
        draftCandidates.map((msg) => msg.messageId)
      );
      if (tombstoned.size > 0) {
        // `getTombstonedDraftMessageIds` returns trimmed Message-Ids (they are
        // stored trimmed), so compare against the trimmed value here — a synced
        // Message-Id carrying stray whitespace would otherwise slip past the
        // suppression and get resurrected.
        const suppressed = draftCandidates.filter((msg) => {
          const trimmedMessageId = msg.messageId?.trim();
          return trimmedMessageId && tombstoned.has(trimmedMessageId);
        });
        const suppressedIds = new Set(suppressed.map((msg) => msg.id));
        messagesToUpsert = strippedMessages.filter((msg) => !suppressedIds.has(msg.id));
        for (const msg of suppressed) {
          if (msg.mailboxPath && typeof msg.imapUid === "number") {
            try {
              await deleteImapMessage(account, msg.mailboxPath, msg.imapUid, clientId);
            } catch (error) {
              console.warn("[sync] failed to delete tombstoned draft from IMAP", {
                accountId: account.id,
                messageId: msg.messageId,
                error
              });
            }
          }
        }
      }
    }

    // Write this batch to database.
    // Never delete existing messages upfront — we upsert incrementally so
    // messages remain visible throughout the sync. Orphan reconciliation
    // (deleting server-removed messages) happens at the end of a fresh full sync.
    await upsertMessages(
      account.id,
      payload.folderId ?? null,
      messagesToUpsert,
      false,
      { recomputeThreads: true }
    );

    // Track processed IDs (for orphan cleanup) over the rows we actually
    // wrote: a suppressed tombstoned draft has no local row, so it must not
    // count as "present" or orphan reconciliation would skip a stale row.
    for (const msg of messagesToUpsert) {
      allProcessedIds.add(msg.id);
    }
    // Advance the resume cursor over the FULL fetched batch, including any
    // suppressed drafts. Their UID was still processed (fetched + deleted), so
    // excluding them could persist a lower highest UID and make a resumed or
    // crash-recovered sync re-fetch the same range and re-hit the same drafts.
    for (const msg of strippedMessages) {
      if (typeof msg.imapUid === "number" && msg.imapUid > 0) {
        if (highestProcessedUid === undefined || msg.imapUid > highestProcessedUid) {
          highestProcessedUid = msg.imapUid;
        }
      }
    }

    // Persist highest UID to DB after each batch so a killed worker can resume.
    // Only done when we have a folder context (per-folder sync).
    if (highestProcessedUid !== undefined && payload.folderId) {
      await updateMailboxHighestUid(account.id, payload.folderId, highestProcessedUid);
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
    if (messagesToUpsert.length > 0) {
      const strippedIds = new Set(messagesToUpsert.map((item) => item.id));
      const syncedMessages = normalizedMessages.filter((message) => strippedIds.has(message.id));

      const shouldProcessInvite = shouldAutoProcessCalendarInvitesForSyncMode(syncMode);
      syncedMessages.forEach((message) => {
        (message.attachments ?? []).forEach((attachment) => {
          if (!isCalendarAttachment(attachment)) return;
          const attachmentBuffer = getAttachmentContentBuffer(attachment);
          if (!attachmentBuffer) return;
          const icsSource = attachmentBuffer.toString("utf8");
          calendarInviteImports.push({
            messageId: message.id,
            icsSource,
            dateValue: message.dateValue,
            imapUid: typeof message.imapUid === "number" ? message.imapUid : undefined,
            process: shouldProcessInvite,
            importOrder: calendarInviteImportOrder++
          });
        });
      });

      // Collect new message notifications (new mode only). Iterate the
      // messages actually written this batch, not `strippedMessages`, so a
      // tombstoned draft that was suppressed above never surfaces a
      // notification for mail that isn't in the local store.
      if (syncMode === "new") {
        messagesToUpsert.forEach((message) => {
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

  const autoProcessCalendarInvites = shouldAutoProcessCalendarInvitesForSyncMode(syncMode);
  const fullyProcessedInviteMessageIds = autoProcessCalendarInvites
    ? new Set(
        await listFullyProcessedCalendarInviteMessageIds(
          account.id,
          calendarInviteImports.filter((invite) => invite.process).map((invite) => invite.messageId)
        )
      )
    : new Set<string>();

  for (const invite of sortCalendarInviteImportsForProcessing(calendarInviteImports)) {
    await processCalendarInviteForMessage({
      accountId: account.id,
      messageId: invite.messageId,
      icsSource: invite.icsSource,
      process: invite.process && !fullyProcessedInviteMessageIds.has(invite.messageId),
      accountEmail: account.email,
      reminderUserId: autoProcessCalendarInvites ? account.ownerUserId : undefined,
      processedByUserId: autoProcessCalendarInvites ? account.ownerUserId : undefined,
      processedAutomatically: autoProcessCalendarInvites ? true : undefined
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
