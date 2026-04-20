"use client";

import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildAccountApiPath,
  buildAccountFolderConsistencyPath,
  buildAccountImapPollPath,
  buildAccountImapStreamPath,
  buildAccountSyncNewCandidatesPath
} from "@/lib/accountApiPaths";
import type { Folder, Message } from "@/lib/data";
import {
  decideFolderConsistencySync,
  decideStreamReconcileSync,
  type FolderSyncDecision,
  type SyncMode
} from "@/lib/syncPolicy";
import { logSyncPolicyCall } from "@/lib/syncPolicyLogging";
import { findInboxFolder } from "@/lib/specialFolders";
import { isRecentLocalDraftSave } from "./recentLocalDraftSaves";
import {
  getResolvedRemoteMailboxFingerprint,
  type FolderConsistencyResponse
} from "./syncFingerprint";
import type {
  FullSyncConfirmState,
  SyncJobProgress,
  SyncJobResult,
  SyncNotificationMessage,
  SyncTriggerOptions
} from "./types";
import {
  FullSyncDebugCancelledError,
  isFullSyncDebugCancelledError,
  type InternalSyncTriggerOptions,
  type NewSyncFolderDecision,
  type SyncJobRequest
} from "./syncJobTypes";
import { applyFlagsToMessage } from "./utils/messageHelpers";
import { prioritizeFolderIds, prioritizeFolders } from "./utils/folderHelpers";
import { withCalendarInviteFlag } from "@/lib/messageFlags";
import { extractEmails } from "./utils/clientHelpers";
import { SYNC_STATUS_POLL_INTERVAL_MS, SYNC_STATUS_RUNNING_POLL_INTERVAL_MS } from "./constants";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type UseSyncControllerParams = {
  activeAccountId: string;
  activeFolderId: string;
  activeVirtualFolderId: string;
  searchScope: "folder" | "all";
  authState: "loading" | "ok" | "unauth";
  inboxMailboxPath: string;
  accountFolders: Folder[];
  currentAccountEmail?: string;
  currentAccountSyncSettings?: {
    maxIdleSessions?: number;
    pollIntervalMs?: number;
  };
  apiFetch: ApiFetch;
  readErrorMessage: (res: Response) => Promise<string>;
  reportError: (message: string) => void;
  pushNotice: (input: {
    type: "info" | "success" | "warning" | "error";
    icon?: "mail";
    title: string;
    description?: string;
    messageId?: string;
    ids?: string[];
    durationMs?: number;
  }) => void;
  showNotification: (
    title: string,
    body: string,
    tag: string,
    opts?: { messageId?: string | null; accountId?: string | null; url?: string }
  ) => Promise<boolean>;
  refreshMailboxData: () => Promise<boolean>;
  refreshFolders: () => Promise<Folder[] | null>;
  refreshPendingCalendarReminders: () => Promise<void>;
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setActiveFolderId: React.Dispatch<React.SetStateAction<string>>;
  isNotificationSuppressedFolder: (folderId: string) => boolean;
  updateMessagesWithCurrentResultPrune: (
    updater: (message: Message) => Message | null,
    options?: { source?: string }
  ) => void;
  confirmFullSyncStart: (state: FullSyncConfirmState) => Promise<boolean>;
  inboxFolder: Folder | null;
  currentKeyRef: React.MutableRefObject<string>;
};

export function useSyncController({
  activeAccountId,
  activeFolderId,
  activeVirtualFolderId,
  searchScope,
  authState,
  inboxMailboxPath,
  accountFolders,
  currentAccountEmail,
  currentAccountSyncSettings,
  apiFetch,
  readErrorMessage,
  reportError,
  pushNotice,
  showNotification,
  refreshMailboxData,
  refreshFolders,
  refreshPendingCalendarReminders,
  setFolders,
  setMessages,
  setActiveFolderId,
  isNotificationSuppressedFolder,
  updateMessagesWithCurrentResultPrune,
  confirmFullSyncStart,
  inboxFolder,
  currentKeyRef
}: UseSyncControllerParams) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRecomputingThreads, setIsRecomputingThreads] = useState(false);
  const [isRecomputingCategories, setIsRecomputingCategories] = useState(false);
  const [syncingFolders, setSyncingFolders] = useState<Set<string>>(new Set());
  const [syncCompletionVersion, setSyncCompletionVersion] = useState(0);
  const [syncProgressByJobId, setSyncProgressByJobId] = useState<
    Record<string, SyncJobProgress>
  >({});
  const [mailCheckMode, setMailCheckMode] = useState<"idle" | "polling">("polling");
  const [streamMode, setStreamMode] = useState<"stream" | "polling" | "idle">("polling");

  const streamSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);
  const recomputePollTimerRef = useRef<number | null>(null);
  const recomputePollInFlightRef = useRef(false);
  const recomputeJobIdRef = useRef<string | null>(null);
  const categoryRecomputePollTimerRef = useRef<number | null>(null);
  const categoryRecomputePollInFlightRef = useRef(false);
  const categoryRecomputeJobIdRef = useRef<string | null>(null);
  const autoRepairAttemptedFolderIdsRef = useRef<Set<string>>(new Set());
  const hasCompletedInitialConsistencyCheckRef = useRef(false);
  const lastUidNextByFolderRef = useRef<Record<string, number>>({});
  const lastNotifiedUidRef = useRef<Record<string, number>>({});
  const notifiedKeysRef = useRef<Set<string>>(new Set());
  const localDeleteReconcileByFolderRef = useRef<Record<string, number>>({});
  const localDeleteReconcileByUidRef = useRef<Record<string, number>>({});
  const lastDeleteReconcileAtRef = useRef<Record<string, number>>({});
  const lastConsistencyFingerprintByFolderRef = useRef<Record<string, string>>({});

  // Stable ref to syncAccount (populated after definition)
  const syncAccountRef = useRef<
    (
      folderId?: string,
      mode?: "new" | "repair" | "full",
      options?: SyncTriggerOptions
    ) => Promise<void> | undefined
  >(undefined);

  const syncStateRef = useRef<{ isSyncing: boolean; syncingFolders: Set<string> }>({
    isSyncing: false,
    syncingFolders: new Set()
  });
  const inboxFolderRef = useRef<Folder | null>(inboxFolder);
  const recomputeThreadsRef = useRef<() => Promise<void>>(async () => {});
  const syncFolderWithBackgroundRef = useRef<
    (
      folderId: string,
      allowRefresh?: boolean,
      mode?: SyncMode,
      options?: InternalSyncTriggerOptions
    ) => Promise<SyncJobResult | null>
  >(async () => null);

  useEffect(() => {
    syncStateRef.current = { isSyncing, syncingFolders };
  }, [isSyncing, syncingFolders]);

  useEffect(() => {
    inboxFolderRef.current = inboxFolder ?? null;
  }, [inboxFolder]);

  useEffect(() => {
    if (!activeAccountId) return;
    const stored = localStorage.getItem(`noctua:lastNotifiedUid:${activeAccountId}`);
    if (stored) {
      const value = Number(stored);
      if (!Number.isNaN(value)) {
        lastNotifiedUidRef.current[activeAccountId] = value;
      }
    }
    hasCompletedInitialConsistencyCheckRef.current = false;
    autoRepairAttemptedFolderIdsRef.current = new Set();
    lastConsistencyFingerprintByFolderRef.current = {};
  }, [activeAccountId]);

  const stopRecomputePoll = useCallback(() => {
    if (recomputePollTimerRef.current) {
      window.clearTimeout(recomputePollTimerRef.current);
      recomputePollTimerRef.current = null;
    }
    recomputePollInFlightRef.current = false;
    recomputeJobIdRef.current = null;
  }, []);

  const stopCategoryRecomputePoll = useCallback(() => {
    if (categoryRecomputePollTimerRef.current) {
      window.clearTimeout(categoryRecomputePollTimerRef.current);
      categoryRecomputePollTimerRef.current = null;
    }
    categoryRecomputePollInFlightRef.current = false;
    categoryRecomputeJobIdRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopRecomputePoll();
      stopCategoryRecomputePoll();
    };
  }, [stopRecomputePoll, stopCategoryRecomputePoll]);

  const waitForSyncJob = async (
    accountId: string,
    jobId: string,
    requestedMode?: string
  ): Promise<SyncJobResult> => {
    const startedAt = Date.now();
    const timeoutMs = 1000 * 60 * 60;
    let loggedEscalation = false;
    const clearProgress = () => {
      setSyncProgressByJobId((prev) => {
        if (!prev[jobId]) return prev;
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
    };
    try {
      while (Date.now() - startedAt < timeoutMs) {
        const statusRes = await apiFetch(
          buildAccountApiPath(accountId, `/sync/status?jobId=${encodeURIComponent(jobId)}`),
          { cache: "no-store" }
        );
        if (!statusRes.ok) {
          throw new Error(await readErrorMessage(statusRes));
        }
        const data = (await statusRes.json()) as {
          ok: boolean;
          job?: {
            status?: "queued" | "running" | "done" | "failed";
            error?: string;
            result?: SyncJobResult;
            progress?: Omit<SyncJobProgress, "jobId">;
          };
        };
        const progress = data.job?.progress;
        if (progress) {
          if (
            !loggedEscalation &&
            requestedMode &&
            progress.mode &&
            progress.mode !== requestedMode
          ) {
            loggedEscalation = true;
            console.warn("[noctua][sync] sync escalated", {
              jobId,
              accountId,
              folderId: progress.folderId ?? null,
              requestedMode,
              escalatedTo: progress.mode
            });
          }
          const nextProgress: SyncJobProgress = {
            ...progress,
            jobId,
            updatedAt: typeof progress.updatedAt === "number" ? progress.updatedAt : Date.now()
          };
          setSyncProgressByJobId((prev) => ({ ...prev, [jobId]: nextProgress }));
        }
        const status = data.job?.status;
        if (status === "done") {
          return data.job?.result ?? { count: 0 };
        }
        if (status === "failed") {
          throw new Error(data.job?.error || "Sync job failed.");
        }
        await new Promise<void>((resolve) => {
          const delayMs =
            status === "running"
              ? SYNC_STATUS_RUNNING_POLL_INTERVAL_MS
              : SYNC_STATUS_POLL_INTERVAL_MS;
          window.setTimeout(resolve, delayMs);
        });
      }
      throw new Error("Sync timed out.");
    } finally {
      clearProgress();
    }
  };

  const requestFullSyncConfirmation = useCallback(async (payload: SyncJobRequest) => {
    const shouldConfirmFullSync =
      (payload.fullSync || payload.mode === "full") && !payload.skipFullSyncConfirm;
    if (!shouldConfirmFullSync) {
      return;
    }

    const reason =
      payload.fullSyncReason?.trim() ||
      (payload.folderId
        ? "Full folder sync requested without an explicit reason."
        : "Full mailbox sync requested without an explicit reason.");
    const folder = payload.folderId
      ? accountFolders.find((item) => item.id === payload.folderId) ?? null
      : null;
    const scopeLabel = folder
      ? `${folder.name} (${payload.folderId})`
      : payload.folderId
        ? payload.folderId
        : "entire mailbox";
    const logPayload = {
      triggerId: payload.triggerId ?? null,
      accountId: payload.accountId,
      folderId: payload.folderId ?? null,
      mode: payload.mode ?? null,
      fullSync: true,
      reason
    };
    console.warn("[noctua][sync] full sync requested", logPayload);
    const confirmed = await confirmFullSyncStart({
      accountId: payload.accountId,
      folderId: payload.folderId ?? null,
      mode: "full",
      scopeLabel,
      reason
    });
    if (!confirmed) {
      console.warn("[noctua][sync] full sync cancelled", logPayload);
      throw new FullSyncDebugCancelledError(reason);
    }
  }, [accountFolders, confirmFullSyncStart]);

  const runSyncJob = async (payload: SyncJobRequest): Promise<SyncJobResult> => {
    const syncMode = payload.mode ?? (payload.fullSync ? "full" : "recent");
    console.info("[noctua][sync] sync requested", {
      triggerId: payload.triggerId ?? null,
      accountId: payload.accountId,
      folderId: payload.folderId ?? null,
      mode: syncMode,
      fullSync: Boolean(payload.fullSync || syncMode === "full"),
      reason: payload.fullSyncReason?.trim() || null,
      recategorizeFolder: Boolean(payload.recategorizeFolder),
      backfillUidCount: payload.backfillUids?.length ?? 0
    });
    await requestFullSyncConfirmation(payload);

    const {
      accountId,
      fullSyncReason: _fullSyncReason,
      triggerId: _triggerId,
      skipFullSyncConfirm: _skipFullSyncConfirm,
      ...requestBody
    } =
      payload;
    const syncRes = await apiFetch(buildAccountApiPath(accountId, "/sync"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });
    if (!syncRes.ok) {
      throw new Error(await readErrorMessage(syncRes));
    }
    const data = (await syncRes.json()) as { ok: boolean; jobId?: string };
    if (!data.jobId) {
      throw new Error("Sync job did not return a job id.");
    }
    return waitForSyncJob(accountId, data.jobId, syncMode);
  };

  const handleSyncLaunchError = useCallback(
    (error: unknown, fallbackMessage: string) => {
      if (isFullSyncDebugCancelledError(error)) {
        pushNotice({
          type: "warning",
          title: "Full sync cancelled",
          description: error.message,
          durationMs: 10000
        });
        return;
      }
      reportError(error instanceof Error ? error.message : fallbackMessage);
    },
    [pushNotice, reportError]
  );

  const planNewSyncCandidates = async (
    folderIds: string[]
  ): Promise<NewSyncFolderDecision[]> => {
    const response = await apiFetch(buildAccountSyncNewCandidatesPath(activeAccountId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderIds })
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    const data = (await response.json()) as {
      ok?: boolean;
      decisions?: NewSyncFolderDecision[];
      message?: string;
    };
    if (data.ok === false) {
      throw new Error(data.message || "Failed to plan new-message sync.");
    }
    return Array.isArray(data.decisions) ? data.decisions : [];
  };

  const checkFolderConsistency = useCallback(async (
    folderId: string
  ): Promise<FolderConsistencyResponse> => {
    const response = await apiFetch(buildAccountFolderConsistencyPath(activeAccountId, folderId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    return (await response.json()) as FolderConsistencyResponse;
  }, [activeAccountId, apiFetch, readErrorMessage]);

  const syncFolderWithBackground = async (
    folderId: string,
    allowRefresh = true,
    mode: SyncMode = "recent",
    options?: InternalSyncTriggerOptions
  ): Promise<SyncJobResult | null> => {
    const selectionKey = currentKeyRef.current;
    setSyncingFolders((prev) => new Set(prev).add(folderId));
    try {
      const syncResult = await runSyncJob({
        accountId: activeAccountId,
        folderId,
        mode,
        recategorizeFolder: Boolean(options?.recategorizeFolder),
        backfillUids: options?.backfillUids,
        fullSyncReason: options?.fullSyncReason,
        triggerId: options?.triggerId,
        skipFullSyncConfirm: options?.skipFullSyncConfirm
      });
      if (allowRefresh && currentKeyRef.current === selectionKey) {
        setSyncCompletionVersion((v) => v + 1);
        if (searchScope === "folder" && activeFolderId === folderId) {
          await refreshMailboxData();
        } else if (activeVirtualFolderId) {
          await refreshMailboxData();
        }
      }
      return syncResult;
    } catch (error) {
      handleSyncLaunchError(error, "Sync failed due to a network error.");
      return null;
    } finally {
      setSyncingFolders((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
    }
  };
  syncFolderWithBackgroundRef.current = syncFolderWithBackground;

  const executeFolderSyncDecision = useCallback(
    async (
      decision: FolderSyncDecision,
      options?: InternalSyncTriggerOptions
    ): Promise<SyncJobResult | null> => {
      if (decision.kind !== "folder") {
        return null;
      }
      return syncFolderWithBackgroundRef.current(
        decision.folderId,
        true,
        decision.mode,
        {
          ...options,
          fullSyncReason: options?.fullSyncReason?.trim() || decision.reason
        }
      );
    },
    []
  );

  const syncNewlyDetectedFolders = async (
    knownFolderIds: Set<string>,
    mode: "new" | "full",
    options?: InternalSyncTriggerOptions
  ) => {
    const nextFolders = await refreshFolders();
    const accountList = (nextFolders ?? accountFolders).filter(
      (folder) => folder.accountId === activeAccountId
    );
    const newlyDetected = accountList.filter((folder) => !knownFolderIds.has(folder.id));
    if (newlyDetected.length === 0) {
      return accountList;
    }
    for (const folder of newlyDetected) {
      // Intentionally use "recent" even when the parent sync is "full":
      // running a full sync on every newly discovered folder would be very
      // expensive. A recent-window sync covers the common case adequately.
      await syncFolderWithBackground(
        folder.id,
        false,
        mode === "new" ? "new" : "recent",
        options
      );
    }
    const refreshed = await refreshFolders();
    return (refreshed ?? accountList).filter((folder) => folder.accountId === activeAccountId);
  };

  const syncAccount = async (
    folderId?: string,
    mode: "new" | "repair" | "full" = "full",
    options?: SyncTriggerOptions
  ) => {
    const selectionKey = currentKeyRef.current;
    const knownFolderIds = new Set(accountFolders.map((folder) => folder.id));
    const syncOptions: InternalSyncTriggerOptions = {
      recategorizeFolder: Boolean(options?.recategorizeFolder),
      fullSyncReason: options?.fullSyncReason,
      triggerId: options?.triggerId
    };
    if (folderId) {
      // mode is typed as "new" | "full", so the "recent" fallback is unreachable
      // defensive code — all call sites pass "new" or "full"
      const folderMode: SyncMode =
        mode === "new" || mode === "repair" || mode === "full" ? mode : "recent";
      await syncFolderWithBackground(
        folderId,
        true,
        folderMode,
        syncOptions
      );
      if (folderMode === "full") {
        await syncNewlyDetectedFolders(knownFolderIds, "full", syncOptions);
      }
      return;
    }

    if (mode === "full" && accountFolders.length > 0) {
      try {
        await requestFullSyncConfirmation({
          accountId: activeAccountId,
          fullSync: true,
          mode: "full",
          fullSyncReason:
            syncOptions.fullSyncReason?.trim() || "Account-wide full sync requested.",
          triggerId: syncOptions.triggerId,
          skipFullSyncConfirm: false
        });
      } catch (error) {
        handleSyncLaunchError(error, "Sync failed due to a network error.");
        return;
      }
      syncOptions.skipFullSyncConfirm = true;
    }

    if (accountFolders.length === 0) {
      setIsSyncing(true);
      try {
        await runSyncJob({
          accountId: activeAccountId,
          fullSync: true,
          mode: "full",
          fullSyncReason:
            syncOptions.fullSyncReason?.trim() ||
            "Account-wide full sync started because no local folders are available.",
          triggerId: syncOptions.triggerId,
          skipFullSyncConfirm: syncOptions.skipFullSyncConfirm
        });
        syncOptions.skipFullSyncConfirm = true;
        const accountList = await syncNewlyDetectedFolders(knownFolderIds, "full", syncOptions);
        const nextInbox = findInboxFolder(accountList, activeAccountId) ?? accountList[0];
        if (nextInbox) {
          setActiveFolderId((prev: string) => prev || nextInbox.id);
        }
        if (currentKeyRef.current === selectionKey) {
          await refreshMailboxData();
        }
      } catch (error) {
        handleSyncLaunchError(error, "Sync failed due to a network error.");
      } finally {
        setIsSyncing(false);
      }
      return;
    }

    setIsSyncing(true);
    void (async () => {
      const accountWideMode: "new" | "full" = mode === "new" ? "new" : "full";
      const resolvedInboxFolderId =
        inboxFolder?.id ?? findInboxFolder(accountFolders, activeAccountId)?.id;
      const sortedFolders =
        accountWideMode === "new"
          ? prioritizeFolders(accountFolders, [resolvedInboxFolderId, activeFolderId])
          : prioritizeFolders(accountFolders, [activeFolderId || resolvedInboxFolderId]);

      if (accountWideMode === "new") {
        const plannedFolders = accountFolders.map((folder) => folder.id);
        let foldersToSync = plannedFolders;
        try {
          const decisions = await planNewSyncCandidates(plannedFolders);
          const decisionMap = new Map(decisions.map((item) => [item.folderId, item]));
          foldersToSync = plannedFolders.filter((id) => {
            const decision = decisionMap.get(id);
            if (!decision) return true;
            return !decision.skip;
          });
        } catch (error) {
          reportError(
            error instanceof Error
              ? error.message
              : "Could not determine new-message sync candidates."
          );
        }

        const foldersToSyncSet = new Set(foldersToSync);
        for (const folder of sortedFolders) {
          if (!foldersToSyncSet.has(folder.id)) {
            continue;
          }
          const refreshThis =
            searchScope === "folder" && activeFolderId === folder.id ? true : false;
          await syncFolderWithBackground(folder.id, refreshThis, "new");
        }
        await syncNewlyDetectedFolders(knownFolderIds, "new");
        if (
          currentKeyRef.current === selectionKey &&
          searchScope === "folder" &&
          activeFolderId
        ) {
          await refreshMailboxData();
        }
        setIsSyncing(false);
        return;
      }
      for (const folder of sortedFolders) {
        await syncFolderWithBackground(
          folder.id,
          false,
          accountWideMode === "full" ? "full" : "recent",
          syncOptions
        );
      }
      await syncNewlyDetectedFolders(knownFolderIds, accountWideMode, syncOptions);
      if (currentKeyRef.current === selectionKey) {
        await refreshMailboxData();
      }
      setIsSyncing(false);
    })();
  };
  syncAccountRef.current = syncAccount;

  // Clear the consistency-check guard when the user navigates to a different folder.
  // This is a separate effect so that unrelated callback identity changes don't
  // clear the guard and re-trigger consistency checks.
  useEffect(() => {
    return () => {
      const repairKey = `${activeAccountId}:${activeFolderId}`;
      autoRepairAttemptedFolderIdsRef.current.delete(repairKey);
    };
  }, [activeAccountId, activeFolderId]);

  useEffect(() => {
    if (authState !== "ok") return;
    if (searchScope !== "folder") return;
    if (!activeAccountId || !activeFolderId || activeVirtualFolderId) return;
    if (syncStateRef.current.isSyncing || syncStateRef.current.syncingFolders.has(activeFolderId)) {
      return;
    }

    const repairKey = `${activeAccountId}:${activeFolderId}`;
    if (autoRepairAttemptedFolderIdsRef.current.has(repairKey)) return;

    let cancelled = false;
    autoRepairAttemptedFolderIdsRef.current.add(repairKey);
    const isInitialConsistencyCheck = !hasCompletedInitialConsistencyCheckRef.current;
    hasCompletedInitialConsistencyCheckRef.current = true;

    void (async () => {
      try {
        const result = await checkFolderConsistency(activeFolderId);
        if (cancelled) return;
        const resolvedFingerprint = getResolvedRemoteMailboxFingerprint(result);
        const lastResolvedFingerprint =
          lastConsistencyFingerprintByFolderRef.current[repairKey] ?? null;
        if (resolvedFingerprint && lastResolvedFingerprint === resolvedFingerprint) {
          console.info("[noctua][sync-policy] skipping folder consistency sync for unchanged remote state", {
            accountId: activeAccountId,
            folderId: activeFolderId,
            remoteFingerprint: resolvedFingerprint
          });
          return;
        }
        const decision = decideFolderConsistencySync({
          folderId: activeFolderId,
          result,
          isInitialCheck: isInitialConsistencyCheck
        });
        const triggerId = logSyncPolicyCall({
          caller: "folder-consistency",
          policy: "decideFolderConsistencySync",
          accountId: activeAccountId,
          folderId: activeFolderId,
          input: {
            result,
            isInitialCheck: isInitialConsistencyCheck
          },
          decision
        });
        if (decision.kind !== "folder") {
          const resolvedFingerprint = getResolvedRemoteMailboxFingerprint(result);
          if (resolvedFingerprint) {
            lastConsistencyFingerprintByFolderRef.current[repairKey] = resolvedFingerprint;
          }
          return;
        }
        const syncResult = await executeFolderSyncDecision(decision, { triggerId });
        if (syncResult) {
          // Only cache a remote fingerprint after a follow-up consistency
          // check confirms the local folder state is healed.
          const postSyncResult = await checkFolderConsistency(activeFolderId);
          if (cancelled) return;
          const resolvedFingerprint = getResolvedRemoteMailboxFingerprint(postSyncResult);
          if (resolvedFingerprint) {
            lastConsistencyFingerprintByFolderRef.current[repairKey] = resolvedFingerprint;
          }
        }
      } catch (error) {
        if (!cancelled) {
          reportError(
            error instanceof Error
              ? error.message
              : "Folder consistency check failed due to a network error."
          );
        }
      }
      // Note: we intentionally do NOT delete the repairKey here. The guard
      // persists until the user navigates to a different folder (handled by
      // the separate cleanup effect above). This prevents the consistency
      // check from re-triggering on every React re-render.
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeAccountId,
    activeFolderId,
    activeVirtualFolderId,
    authState,
    searchScope,
    checkFolderConsistency,
    executeFolderSyncDecision,
    reportError
  ]);

  const recomputeThreads = async () => {
    if (!activeAccountId) return;
    const accountId = activeAccountId;
    stopRecomputePoll();
    setIsRecomputingThreads(true);
    try {
      const res = await apiFetch(buildAccountApiPath(accountId, "/threads/recompute"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        setIsRecomputingThreads(false);
        return;
      }
      const data = (await res.json()) as { jobId?: string };
      if (!data?.jobId) {
        reportError("Thread recompute did not return a job id.");
        setIsRecomputingThreads(false);
        return;
      }
      const jobId = data.jobId;
      recomputeJobIdRef.current = jobId;

      const pollOnce = async () => {
        if (recomputePollInFlightRef.current) return;
        if (recomputeJobIdRef.current !== jobId) return;
        recomputePollInFlightRef.current = true;
        try {
          const statusRes = await apiFetch(
            buildAccountApiPath(accountId, `/threads/recompute/status?jobId=${encodeURIComponent(jobId)}`)
          );
          if (!statusRes.ok) {
            reportError(await readErrorMessage(statusRes));
            stopRecomputePoll();
            setIsRecomputingThreads(false);
            return;
          }
          const statusData = (await statusRes.json()) as {
            job?: { status?: string; error?: string };
          };
          const status = statusData?.job?.status;
          if (status === "done") {
            stopRecomputePoll();
            setIsRecomputingThreads(false);
            await refreshMailboxData();
            return;
          }
          if (status === "failed") {
            reportError(statusData?.job?.error || "Thread recompute failed.");
            stopRecomputePoll();
            setIsRecomputingThreads(false);
            return;
          }
        } catch {
          reportError("Failed to check thread recompute status.");
          stopRecomputePoll();
          setIsRecomputingThreads(false);
          return;
        } finally {
          recomputePollInFlightRef.current = false;
        }
        recomputePollTimerRef.current = window.setTimeout(pollOnce, 1000);
      };

      void pollOnce();
    } catch {
      reportError("Thread recompute failed due to a network error.");
      setIsRecomputingThreads(false);
    }
  };
  recomputeThreadsRef.current = recomputeThreads;

  const recomputeCategories = async () => {
    if (!activeAccountId) return;
    const accountId = activeAccountId;
    stopCategoryRecomputePoll();
    setIsRecomputingCategories(true);
    try {
      const res = await apiFetch(buildAccountApiPath(accountId, "/categories/recompute"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        setIsRecomputingCategories(false);
        return;
      }
      const data = (await res.json()) as { jobId?: string };
      if (!data?.jobId) {
        reportError("Category recompute did not return a job id.");
        setIsRecomputingCategories(false);
        return;
      }
      const jobId = data.jobId;
      categoryRecomputeJobIdRef.current = jobId;

      const pollOnce = async () => {
        if (categoryRecomputePollInFlightRef.current) return;
        if (categoryRecomputeJobIdRef.current !== jobId) return;
        categoryRecomputePollInFlightRef.current = true;
        try {
          const statusRes = await apiFetch(
            buildAccountApiPath(accountId, `/categories/recompute/status?jobId=${encodeURIComponent(jobId)}`)
          );
          if (!statusRes.ok) {
            reportError(await readErrorMessage(statusRes));
            stopCategoryRecomputePoll();
            setIsRecomputingCategories(false);
            return;
          }
          const statusData = (await statusRes.json()) as {
            job?: { status?: string; error?: string };
          };
          const status = statusData?.job?.status;
          if (status === "done") {
            stopCategoryRecomputePoll();
            setIsRecomputingCategories(false);
            await refreshMailboxData();
            return;
          }
          if (status === "failed") {
            reportError(statusData?.job?.error || "Category recompute failed.");
            stopCategoryRecomputePoll();
            setIsRecomputingCategories(false);
            return;
          }
        } catch {
          reportError("Failed to check category recompute status.");
          stopCategoryRecomputePoll();
          setIsRecomputingCategories(false);
          return;
        } finally {
          categoryRecomputePollInFlightRef.current = false;
        }
        categoryRecomputePollTimerRef.current = window.setTimeout(pollOnce, 1000);
      };

      void pollOnce();
    } catch {
      reportError("Category recompute failed due to a network error.");
      setIsRecomputingCategories(false);
    }
  };

  // Stream / poll effect
  useEffect(() => {
    if (authState !== "ok") return;
    if (!activeAccountId || !inboxMailboxPath) return;
    let disposed = false;
    let streamReconnectTimer: number | null = null;

    const stopPoll = () => {
      if (pollTimerRef.current) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const notifyNewMessages = async (
      items:
        | Array<{
            uid: number;
            subject?: string;
            from?: string;
            messageId?: string | null;
            folderId?: string;
            category?: string | null;
          }>
        | null
        | undefined
    ) => {
      if (!items || items.length === 0) return;
      const normalized = items.filter(
        (
          item
        ): item is {
          uid: number;
          subject?: string;
          from?: string;
          messageId?: string | null;
          folderId?: string;
          category?: string | null;
        } => Boolean(item) && typeof item.uid === "number"
      );
      if (normalized.length === 0) return;
      const eligible = normalized.filter(
        (item) => !item.folderId || !isNotificationSuppressedFolder(item.folderId)
      );
      if (eligible.length === 0) return;
      const lastNotified = lastNotifiedUidRef.current[activeAccountId] ?? null;
      const maxUid = Math.max(...normalized.map((item) => item.uid));
      if (lastNotified == null) {
        lastNotifiedUidRef.current[activeAccountId] = maxUid;
        localStorage.setItem(`noctua:lastNotifiedUid:${activeAccountId}`, String(maxUid));
        return;
      }
      const eligibleByUid = eligible.filter((item) => item.uid > lastNotified);
      if (eligibleByUid.length === 0) {
        if (maxUid > lastNotified) {
          lastNotifiedUidRef.current[activeAccountId] = maxUid;
          localStorage.setItem(`noctua:lastNotifiedUid:${activeAccountId}`, String(maxUid));
        }
        return;
      }
      const accountEmail = currentAccountEmail?.toLowerCase() ?? "";
      const notFromMe = eligibleByUid.filter((item) => {
        if (!accountEmail) return true;
        const fromEmails = extractEmails(item.from);
        return !fromEmails.some((email) => email.toLowerCase() === accountEmail);
      });
      const notNewsletter = notFromMe.filter((item) => item.category !== "newsletter");
      const unique = notNewsletter.filter((item) => {
        const key = item.messageId || `uid:${item.uid}`;
        if (notifiedKeysRef.current.has(key)) return false;
        notifiedKeysRef.current.add(key);
        return true;
      });
      if (notifiedKeysRef.current.size > 200) {
        const iterator = notifiedKeysRef.current.values();
        for (let i = 0; i < 50; i += 1) {
          const next = iterator.next();
          if (next.done) break;
          notifiedKeysRef.current.delete(next.value);
        }
      }
      if (maxUid > lastNotified) {
        lastNotifiedUidRef.current[activeAccountId] = maxUid;
        localStorage.setItem(`noctua:lastNotifiedUid:${activeAccountId}`, String(maxUid));
      }

      if (unique.length === 1) {
        const message = unique[0];
        const title = message.subject || "(no subject)";
        const body = message.from ? `From: ${message.from}` : "New message received";
        console.info("[noctua] new mail", message);
        await showNotification(title, body, `mail-${message.messageId ?? message.uid}`, {
          messageId: message.messageId ?? null,
          accountId: activeAccountId
        });
        pushNotice({
          type: "info",
          icon: "mail",
          title,
          description: body,
          messageId: message.messageId ?? undefined,
          durationMs: 12000
        });
      } else if (unique.length > 1) {
        const title = `${unique.length} new messages`;
        const preview = unique
          .slice(0, 3)
          .map((item) => item.subject || "(no subject)")
          .join(" • ");
        console.info("[noctua] new mail batch", unique);
        await showNotification(title, preview, "mail-batch", { url: "/" });
        pushNotice({
          type: "info",
          icon: "mail",
          title,
          description: preview,
          ids: unique.map((item) => item.messageId ?? undefined).filter(Boolean) as string[],
          durationMs: 12000
        });
      }
    };

    const syncAndNotifyNewMessages = async (
      items:
        | Array<{
            uid: number;
            subject?: string;
            from?: string;
            messageId?: string | null;
            folderId?: string;
          }>
        | null
        | undefined
    ) => {
      if (!items || items.length === 0) return;
      const normalized = items.filter(
        (
          item
        ): item is {
          uid: number;
          subject?: string;
          from?: string;
          messageId?: string | null;
          folderId?: string;
        } => Boolean(item) && typeof item.uid === "number"
      );
      if (normalized.length === 0) return;
      const fallbackFolderId = inboxFolderRef.current?.id;
      const externalItems = normalized.filter((item) => {
        const folderId = item.folderId ?? fallbackFolderId ?? null;
        return !isRecentLocalDraftSave({
          accountId: activeAccountId,
          folderId,
          messageId: item.messageId ?? null,
          uid: item.uid
        });
      });
      if (externalItems.length === 0) return;
      const foldersToSync = prioritizeFolderIds(
        Array.from(
          new Set(
            externalItems
              .map((item) => item.folderId ?? fallbackFolderId)
              .filter((id): id is string => Boolean(id))
          )
        ),
        [fallbackFolderId]
      );
      if (foldersToSync.length === 0) return;

      const syncedMessages: SyncNotificationMessage[] = [];
      for (const fId of foldersToSync) {
        // The stream/poll effect is intentionally long-lived; use the ref-backed
        // sync function so active-folder refreshes follow the latest list state.
        const result = await syncFolderWithBackgroundRef.current(fId, true, "new");
        if (!result?.newMessages?.length) continue;
        syncedMessages.push(...result.newMessages);
      }
      if (syncedMessages.length === 0) return;
      await refreshPendingCalendarReminders();
      await notifyNewMessages(syncedMessages);
    };

    const pollOnce = async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const inboxFolderId = inboxFolderRef.current?.id;
        const params = new URLSearchParams({
          mailbox: inboxMailboxPath
        });
        const since = inboxFolderId ? lastUidNextByFolderRef.current[inboxFolderId] : undefined;
        if (typeof since === "number" && Number.isFinite(since)) {
          params.set("sinceUidNext", String(since));
        }
        const res = await apiFetch(buildAccountImapPollPath(activeAccountId, params));
        if (!res.ok) {
          reportError(await readErrorMessage(res));
          return;
        }
        const data = (await res.json()) as {
          ok?: boolean;
          uidNext?: number;
          messages?: Array<{ uid: number; subject?: string; from?: string; messageId?: string }>;
          message?: string;
        };
        if (data?.ok === false) {
          reportError(data.message || "Failed to check for new mail.");
          return;
        }
        if (typeof data?.uidNext === "number" && inboxFolderId) {
          lastUidNextByFolderRef.current[inboxFolderId] = data.uidNext;
        }
        if (Array.isArray(data?.messages) && data.messages.length > 0) {
          await syncAndNotifyNewMessages(data.messages);
        }
      } catch {
        reportError("Failed to check for new mail.");
      } finally {
        pollInFlightRef.current = false;
      }
    };

    const startPoll = (intervalMs: number) => {
      stopPoll();
      setMailCheckMode("polling");
      setStreamMode("polling");
      void pollOnce();
      pollTimerRef.current = window.setInterval(pollOnce, intervalMs);
    };

    const streamMaxIdle = currentAccountSyncSettings?.maxIdleSessions ?? 3;
    const streamPollInterval = currentAccountSyncSettings?.pollIntervalMs ?? 300000;

    const stopStream = () => {
      if (streamSourceRef.current) {
        streamSourceRef.current.close();
        streamSourceRef.current = null;
      }
    };

    const shouldSkipDeleteReconcile = (folderId?: string, uid?: number) => {
      if (!folderId) return false;
      const now = Date.now();
      const folderExpiry = localDeleteReconcileByFolderRef.current[folderId] ?? 0;
      if (folderExpiry <= now) {
        if (folderExpiry > 0) {
          delete localDeleteReconcileByFolderRef.current[folderId];
        }
      } else {
        return true;
      }
      if (typeof uid !== "number" || !Number.isFinite(uid)) return false;
      const uidKey = `${folderId}:${uid}`;
      const uidExpiry = localDeleteReconcileByUidRef.current[uidKey] ?? 0;
      if (uidExpiry <= now) {
        if (uidExpiry > 0) {
          delete localDeleteReconcileByUidRef.current[uidKey];
        }
        return false;
      }
      return true;
    };

    const requestFolderReconcileSync = (
      folderId?: string,
      mode: "repair" | "full" = "repair"
    ) => {
      const decision = decideStreamReconcileSync({ folderId, mode });
      const triggerId = logSyncPolicyCall({
        caller: "stream-reconcile",
        policy: "decideStreamReconcileSync",
        accountId: activeAccountId,
        folderId: folderId ?? null,
        input: {
          folderId: folderId ?? null,
          mode
        },
        decision
      });
      if (decision.kind !== "folder") return;
      const now = Date.now();
      const lastRun = lastDeleteReconcileAtRef.current[decision.folderId] ?? 0;
      if (now - lastRun < 5000) return;
      const { isSyncing: syncing, syncingFolders: syncingSet } = syncStateRef.current;
      if (syncing || syncingSet.has(decision.folderId)) return;
      lastDeleteReconcileAtRef.current[decision.folderId] = now;
      const reconcileMode: "repair" | "full" =
        decision.mode === "full" ? "full" : "repair";
      void syncAccountRef.current?.(
        decision.folderId,
        reconcileMode,
        {
          fullSyncReason: decision.reason,
          triggerId
        }
      );
    };

    const startStream = () => {
      stopStream();
      stopPoll();
      if (typeof window === "undefined" || !("EventSource" in window)) {
        startPoll(streamPollInterval);
        return;
      }
      const params = new URLSearchParams();
      if (activeFolderId) {
        params.set("activeFolderId", activeFolderId);
      }
      const source = new EventSource(buildAccountImapStreamPath(activeAccountId, params));
      streamSourceRef.current = source;

      source.addEventListener("open", () => {
        setMailCheckMode("idle");
        setStreamMode("stream");
      });
      source.addEventListener("folder:update", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as Array<{
            id: string;
            uidNext?: number;
            unseen?: number;
            exists?: number;
          }>;
          if (Array.isArray(data)) {
            setFolders((prev) =>
              prev.map((folder) => {
                const update = data.find((item) => item.id === folder.id);
                if (!update) return folder;
                const nextCount =
                  typeof update.exists === "number" ? update.exists : folder.count;
                const nextUnread =
                  typeof update.unseen === "number"
                    ? update.unseen
                    : folder.unreadCount ?? folder.count;
                return { ...folder, count: nextCount, unreadCount: nextUnread };
              })
            );
            data.forEach((item) => {
              if (typeof item.uidNext === "number") {
                lastUidNextByFolderRef.current[item.id] = item.uidNext;
              }
            });
          }
        } catch {
          // ignore
        }
      });
      source.addEventListener("new", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as {
            uidNext?: number;
            messages?: Array<{
              uid: number;
              subject?: string;
              from?: string;
              messageId?: string | null;
              folderId?: string;
            }>;
          };
          if (Array.isArray(data?.messages) && data.messages.length > 0) {
            const nextUid = data?.uidNext;
            if (typeof nextUid === "number") {
              data.messages.forEach((msg) => {
                if (msg.folderId) {
                  lastUidNextByFolderRef.current[msg.folderId] = nextUid;
                }
              });
            }
            void syncAndNotifyNewMessages(data.messages);
          }
        } catch {
          // ignore parse errors
        }
      });
      source.addEventListener("flags:update", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as {
            folderId?: string;
            uid?: number;
            flags?: string[];
          };
          if (!data || typeof data.uid !== "number") return;
          updateMessagesWithCurrentResultPrune(
            (msg) => {
              if (
                msg.accountId !== activeAccountId ||
                msg.imapUid !== data.uid ||
                (data.folderId && msg.folderId !== data.folderId)
              ) {
                return msg;
              }
              const flags = withCalendarInviteFlag(data.flags ?? msg.flags ?? [], {
                attachments: msg.attachments,
                textBody: msg.body,
                htmlBody: msg.htmlBody
              });
              return applyFlagsToMessage(msg, flags);
            },
            { source: "stream-flags-update" }
          );
        } catch {
          // ignore
        }
      });
      source.addEventListener("message:removed", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data) as {
            folderId?: string;
            uid?: number;
            reconciled?: boolean;
          };
          const fId = data.folderId ?? activeFolderId;
          if (data.uid && fId) {
            setMessages((prev) =>
              prev.filter((msg) => !(msg.folderId === fId && msg.imapUid === data.uid))
            );
            setFolders((prev) =>
              prev.map((folder) =>
                folder.id === fId
                  ? { ...folder, count: Math.max(0, (folder.count ?? 0) - 1) }
                  : folder
              )
            );
            if (data.reconciled !== false) {
              return;
            }
          }
          if (shouldSkipDeleteReconcile(fId, data.uid)) return;
          requestFolderReconcileSync(fId, "repair");
        } catch {
          // ignore
        }
      });
      source.addEventListener("error", () => {
        stopStream();
        setMailCheckMode("polling");
        setStreamMode("polling");
        startPoll(streamPollInterval);
        if (!disposed) {
          if (streamReconnectTimer) window.clearTimeout(streamReconnectTimer);
          streamReconnectTimer = window.setTimeout(() => {
            if (!disposed && document.visibilityState === "visible") {
              startStream();
            }
          }, 15000);
        }
      });
    };

    // Suppress unused variable warning for streamMaxIdle
    void streamMaxIdle;

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        startStream();
      } else {
        stopStream();
        startPoll(Math.max(120000, streamPollInterval));
      }
    };

    handleVisibility();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", stopStream);
    window.addEventListener("beforeunload", stopStream);

    return () => {
      disposed = true;
      if (streamReconnectTimer) {
        window.clearTimeout(streamReconnectTimer);
        streamReconnectTimer = null;
      }
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", stopStream);
      window.removeEventListener("beforeunload", stopStream);
      stopStream();
      stopPoll();
    };
    // Other values used inside (apiFetch, reportError, callbacks, etc.) are accessed via stable
    // refs or useCallback wrappers and should not re-trigger a full stream/poll reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, activeFolderId, authState, inboxMailboxPath]);

  return {
    // State
    isSyncing,
    setIsSyncing,
    isRecomputingThreads,
    setIsRecomputingThreads,
    isRecomputingCategories,
    setIsRecomputingCategories,
    syncingFolders,
    setSyncingFolders,
    syncCompletionVersion,
    setSyncCompletionVersion,
    syncProgressByJobId,
    mailCheckMode,
    streamMode,
    // Refs
    syncStateRef,
    syncAccountRef,
    recomputeThreadsRef,
    syncFolderWithBackgroundRef,
    autoRepairAttemptedFolderIdsRef,
    lastUidNextByFolderRef,
    localDeleteReconcileByFolderRef,
    localDeleteReconcileByUidRef,
    // Actions
    syncAccount,
    runSyncJob,
    recomputeThreads,
    recomputeCategories
  };
}
