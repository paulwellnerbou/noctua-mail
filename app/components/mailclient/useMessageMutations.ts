import { useCallback } from "react";
import type React from "react";
import { buildAccountMessageActionPath, buildAccountMessagesActionPath } from "@/lib/accountApiPaths";
import type { Message } from "@/lib/data";
import { applyFlagsToMessage, isFlaggedMessage, hasTodoFlag, hasDoneFlag, getUnsubscribeCapability } from "./utils/messageHelpers";
import {
  computeOptimisticMovedMessage,
  getMessageSubjectForNotice,
  resolveMoveViewTransition
} from "./utils/messageMutation";
import { TODO_FLAG, DONE_FLAG } from "@/lib/messageFlags";
import { NOTICE_TIMEOUTS } from "./constants";
import type { UndoMoveTarget } from "./useMessageMoveActions";

type UseMessageMutationsProps = {
  activeAccountId: string;
  searchScope: "folder" | "all";
  viewMessage: Message | null;
  hasFilteredSearchCriteria: boolean;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readErrorMessage: (res: Response) => Promise<string>;
  reportError: (message: string, meta?: { requestPath?: string; status?: number }) => void;
  pushNotice: (notice: any) => void;
  updateMessagesWithCurrentResultPrune: (
    updater: (message: Message) => Message | null,
    options?: { source?: string }
  ) => void;
  setViewMessage: (msg: Message | null) => void;
  setActiveMessageId: (id: string) => void;
  setFolders: React.Dispatch<React.SetStateAction<any[]>>;
  setPendingMessageActions: React.Dispatch<React.SetStateAction<Set<string>>>;
  evictMessageCaches: (messageIds: string[]) => void;
  shouldKeepMessageInCurrentResults: (message: Message) => boolean;
  undoMoveOperation: (targets: UndoMoveTarget[], accountId: string, successTitle?: string) => void;
  confirmUnsubscribe: (sender: string, listId?: string) => Promise<boolean>;
  applyMoveReconcileSuppression: (messages: Message[]) => void;
  setActiveTopicSuggestionMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  updateThreadCacheWithFlags: (messageId: string, flags: string[]) => void;
  updateThreadCacheWithCategory: (
    messageId: string,
    category: string | null,
    categoryScore: number | null,
    categorySignals: string[]
  ) => void;
  queueFilteredSearchRefresh: (hasCriteria: boolean) => void;
};

type SystemFlag = "seen" | "answered" | "flagged" | "draft" | "deleted";
type MoveReconcileParams = {
  movedMessageId: string;
  destinationFolderId?: string | null;
  destinationMailbox?: string;
  flags?: string[];
  source: string;
  successTitle: string;
  undoSuccessMessage: string;
};

export function useMessageMutations({
  activeAccountId,
  searchScope,
  viewMessage,
  hasFilteredSearchCriteria,
  apiFetch,
  readErrorMessage,
  reportError,
  pushNotice,
  updateMessagesWithCurrentResultPrune,
  setViewMessage,
  setActiveMessageId,
  setFolders,
  setPendingMessageActions,
  evictMessageCaches,
  shouldKeepMessageInCurrentResults,
  undoMoveOperation,
  confirmUnsubscribe,
  applyMoveReconcileSuppression,
  setActiveTopicSuggestionMessages,
  updateThreadCacheWithFlags,
  updateThreadCacheWithCategory,
  queueFilteredSearchRefresh
}: UseMessageMutationsProps) {
  const reconcileMessageFlags = useCallback((
    message: Message,
    flags: string[],
    source: string
  ) => {
    const updatedMessage = applyFlagsToMessage(message, flags);
    const shouldKeepUpdatedMessage = shouldKeepMessageInCurrentResults(updatedMessage);
    updateMessagesWithCurrentResultPrune(
      (item) => (item.id === message.id ? applyFlagsToMessage(item, flags) : item),
      { source }
    );
    setActiveTopicSuggestionMessages((prev) => {
      if (!prev.some((item) => item.id === message.id)) return prev;
      return prev.map((item) =>
        item.id === message.id ? applyFlagsToMessage(item, flags) : item
      );
    });
    updateThreadCacheWithFlags(message.id, flags);
    if (viewMessage?.id === message.id && !shouldKeepUpdatedMessage) {
      setViewMessage(null);
      setActiveMessageId("");
    }
    return updatedMessage;
  }, [
    setActiveMessageId,
    setActiveTopicSuggestionMessages,
    setViewMessage,
    shouldKeepMessageInCurrentResults,
    updateMessagesWithCurrentResultPrune,
    updateThreadCacheWithFlags,
    viewMessage?.id
  ]);

  const reportResponseError = useCallback(async (res: Response) => {
    const message = await readErrorMessage(res);
    let requestPath: string | undefined;
    try {
      if (res.url) {
        const url = new URL(res.url);
        requestPath = `${url.pathname}${url.search}`;
      }
    } catch {
      // ignore
    }
    reportError(message, { requestPath, status: res.status });
  }, [readErrorMessage, reportError]);

  const requestMessageFlagMutation = useCallback(async (
    messageId: string,
    payload: { value: boolean; flag?: SystemFlag; keyword?: string }
  ) => {
    const res = await apiFetch(buildAccountMessageActionPath(activeAccountId, messageId, "flags"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      await reportResponseError(res);
      return null;
    }
    const data = (await res.json()) as { flags?: string[] };
    return data.flags ?? [];
  }, [activeAccountId, apiFetch, reportResponseError]);

  const requestBulkFlagMutation = useCallback(async (
    messageIds: string[],
    payload: { value: boolean; flag?: SystemFlag; keyword?: string }
  ) => {
    const res = await apiFetch(buildAccountMessagesActionPath(activeAccountId, "flags/bulk"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, messageIds })
    });
    if (!res.ok) {
      await reportResponseError(res);
      return null;
    }
    const data = (await res.json()) as {
      results?: Array<{ messageId: string; flags: string[] }>;
      skipped?: Array<{ messageId: string; reason: string }>;
    };
    if (data.skipped && data.skipped.length > 0) {
      pushNotice({
        type: "warning",
        title: `Skipped ${data.skipped.length} message${data.skipped.length === 1 ? "" : "s"}`,
        description: data.skipped[0]?.reason
      });
    }
    return data.results ?? [];
  }, [activeAccountId, apiFetch, pushNotice, reportResponseError]);

  const reconcileMoveMutation = useCallback((
    message: Message,
    params: MoveReconcileParams
  ) => {
    const {
      movedMessageId,
      destinationFolderId,
      destinationMailbox,
      flags,
      source,
      successTitle,
      undoSuccessMessage
    } = params;
    evictMessageCaches(Array.from(new Set([message.id, movedMessageId])));

    const optimisticParams = {
      movedMessageId,
      destinationFolderId,
      destinationMailbox,
      flags,
      searchScope
    };
    const movedMessage = computeOptimisticMovedMessage(message, optimisticParams);

    updateMessagesWithCurrentResultPrune((item) => {
      if (item.id !== message.id) return item;
      return computeOptimisticMovedMessage(item, optimisticParams);
    }, { source });

    const transition = resolveMoveViewTransition(
      viewMessage,
      message.id,
      movedMessage,
      shouldKeepMessageInCurrentResults
    );
    if (transition.kind === "clear") {
      setViewMessage(null);
      setActiveMessageId("");
    } else if (transition.kind === "retarget") {
      setViewMessage(transition.nextViewMessage);
      setActiveMessageId(transition.nextActiveMessageId);
    }

    const undoTarget: UndoMoveTarget = {
      messageId: movedMessageId,
      restoreFolderId: message.folderId
    };
    pushNotice({
      type: "success",
      title: successTitle,
      description: getMessageSubjectForNotice(message),
      actionLabel: destinationFolderId ? "Undo" : undefined,
      onAction:
        destinationFolderId
          ? () => undoMoveOperation([undoTarget], activeAccountId, undoSuccessMessage)
          : undefined,
      durationMs: NOTICE_TIMEOUTS.success
    });
  }, [
    activeAccountId,
    evictMessageCaches,
    pushNotice,
    searchScope,
    setActiveMessageId,
    setViewMessage,
    shouldKeepMessageInCurrentResults,
    undoMoveOperation,
    updateMessagesWithCurrentResultPrune,
    viewMessage?.id
  ]);

  const handleArchiveMessage = useCallback(async (message: Message) => {
    try {
      applyMoveReconcileSuppression([message]);
      const res = await apiFetch(buildAccountMessageActionPath(activeAccountId, message.id, "archive"), {
        method: "POST"
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as {
        action: "moved";
        archiveFolderId?: string | null;
        archiveMailbox?: string;
        flags?: string[];
        previousMessageId?: string;
        messageId?: string;
      };
      reconcileMoveMutation(message, {
        movedMessageId: data.messageId ?? message.id,
        destinationFolderId: data.archiveFolderId,
        destinationMailbox: data.archiveMailbox,
        flags: data.flags,
        source: "archive-message",
        successTitle: "Message archived.",
        undoSuccessMessage: "Archive undone."
      });
    } catch {
      reportError("Failed to archive message.");
    }
  }, [
    activeAccountId,
    apiFetch,
    applyMoveReconcileSuppression,
    readErrorMessage,
    reconcileMoveMutation,
    reportError
  ]);

  const handleUnsubscribe = useCallback(
    async (message: Message) => {
      const capability = getUnsubscribeCapability(message);
      if (!capability) return;

      // For one-click, show a confirmation dialog
      if (capability === "one-click") {
        // Parse List-Id from the stored header string
        let listId: string | undefined;
        if (message.listUnsubscribe) {
          const lines = message.listUnsubscribe.split("\\n");
          for (const line of lines) {
            if (line.startsWith("List-Id:")) {
              listId = line.substring("List-Id:".length).trim();
              break;
            }
          }
        }
        const confirmed = await confirmUnsubscribe(message.from, listId);
        if (!confirmed) return;
      }

      setPendingMessageActions((prev) => new Set(prev).add(message.id));
      try {
        const res = await apiFetch(buildAccountMessageActionPath(activeAccountId, message.id, "unsubscribe"), {
          method: "POST"
        });

        if (!res.ok) {
          const errMsg = await readErrorMessage(res);
          reportError(errMsg || "Failed to unsubscribe");
          return;
        }

        const data = (await res.json()) as {
          ok: boolean;
          method: "one-click" | "browser" | "mailto";
          url?: string;
        };

        if (data.method === "one-click") {
          pushNotice({
            type: "success",
            title: "Unsubscribed",
            description: "Unsubscribe request sent successfully.",
            durationMs: NOTICE_TIMEOUTS.success
          });
        } else if (data.method === "browser" && data.url) {
          window.open(data.url, "_blank", "noopener,noreferrer");
        } else if (data.method === "mailto" && data.url) {
          window.location.href = data.url;
        }
      } catch (error) {
        reportError(error instanceof Error ? error.message : "Unsubscribe failed");
      } finally {
        setPendingMessageActions((prev) => {
          const next = new Set(prev);
          next.delete(message.id);
          return next;
        });
      }
    },
    [activeAccountId, apiFetch, readErrorMessage, reportError, pushNotice, confirmUnsubscribe, setPendingMessageActions]
  );

  const handleMarkSpam = useCallback(async (message: Message) => {
    setPendingMessageActions((prev) => new Set(prev).add(message.id));
    try {
      applyMoveReconcileSuppression([message]);
      const res = await apiFetch(buildAccountMessageActionPath(activeAccountId, message.id, "spam"), {
        method: "POST"
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as {
        action: "moved";
        junkFolderId?: string | null;
        junkMailbox?: string;
        flags?: string[];
        previousMessageId?: string;
        messageId?: string;
      };
      reconcileMoveMutation(message, {
        movedMessageId: data.messageId ?? message.id,
        destinationFolderId: data.junkFolderId,
        destinationMailbox: data.junkMailbox,
        flags: data.flags,
        source: "mark-spam",
        successTitle: "Message marked as spam.",
        undoSuccessMessage: "Spam action undone."
      });
    } catch {
      reportError("Failed to mark message as spam.");
    } finally {
      setPendingMessageActions((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
    }
  }, [
    activeAccountId,
    apiFetch,
    applyMoveReconcileSuppression,
    readErrorMessage,
    reconcileMoveMutation,
    reportError,
    setPendingMessageActions
  ]);

  const handleMarkNotSpam = useCallback(async (message: Message) => {
    setPendingMessageActions((prev) => new Set(prev).add(message.id));
    try {
      applyMoveReconcileSuppression([message]);
      const res = await apiFetch(buildAccountMessageActionPath(activeAccountId, message.id, "not-spam"), {
        method: "POST"
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as {
        action: "moved";
        inboxFolderId?: string | null;
        inboxMailbox?: string;
        flags?: string[];
        previousMessageId?: string;
        messageId?: string;
      };
      reconcileMoveMutation(message, {
        movedMessageId: data.messageId ?? message.id,
        destinationFolderId: data.inboxFolderId,
        destinationMailbox: data.inboxMailbox,
        flags: data.flags,
        source: "mark-not-spam",
        successTitle: "Message marked as not spam.",
        undoSuccessMessage: "Not-spam action undone."
      });
    } catch {
      reportError("Failed to mark message as not spam.");
    } finally {
      setPendingMessageActions((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
    }
  }, [
    activeAccountId,
    apiFetch,
    applyMoveReconcileSuppression,
    readErrorMessage,
    reconcileMoveMutation,
    reportError,
    setPendingMessageActions
  ]);

  // Pass `flag = "seen"` to also adjust the per-folder unread count;
  // any other system flag or `null` (for keywords) skips that bookkeeping.
  // A bulk selection in cross-folder views may span multiple folders, so
  // deltas are aggregated per folderId before the single setFolders update.
  const applyFlagsResults = useCallback((
    pairs: Array<{ message: Message; nextFlags: string[] }>,
    flag: SystemFlag | null,
    source: string
  ) => {
    const unreadDeltaByFolderId = new Map<string, number>();
    for (const { message, nextFlags } of pairs) {
      const updatedMessage = reconcileMessageFlags(message, nextFlags, source);
      if (flag !== "seen") continue;
      const previousSeen = Boolean(message.seen);
      const nextSeen = Boolean(updatedMessage.seen);
      if (previousSeen === nextSeen) continue;
      const delta = previousSeen ? 1 : -1;
      unreadDeltaByFolderId.set(
        message.folderId,
        (unreadDeltaByFolderId.get(message.folderId) ?? 0) + delta
      );
    }
    if (unreadDeltaByFolderId.size === 0) return;
    setFolders((prev) =>
      prev.map((f) => {
        const delta = unreadDeltaByFolderId.get(f.id);
        if (!delta) return f;
        return { ...f, unreadCount: Math.max(0, (f.unreadCount ?? 0) + delta) };
      })
    );
  }, [reconcileMessageFlags, setFolders]);

  const updateFlagState = useCallback(async (
    message: Message,
    flag: SystemFlag,
    value: boolean
  ) => {
    try {
      const flags = await requestMessageFlagMutation(message.id, { flag, value });
      if (!flags) return;
      applyFlagsResults([{ message, nextFlags: flags }], flag, "update-flag-state");
      queueFilteredSearchRefresh(hasFilteredSearchCriteria);
    } catch {
      reportError("Failed to update message flag.");
    }
  }, [
    applyFlagsResults, hasFilteredSearchCriteria, queueFilteredSearchRefresh, reportError,
    requestMessageFlagMutation
  ]);

  const updateKeywordFlag = useCallback(async (
    message: Message,
    keyword: string,
    value: boolean
  ) => {
    try {
      const flags = await requestMessageFlagMutation(message.id, { keyword, value });
      if (!flags) return;
      applyFlagsResults([{ message, nextFlags: flags }], null, "update-keyword-flag");
      queueFilteredSearchRefresh(hasFilteredSearchCriteria);
    } catch {
      reportError("Failed to update message keyword.");
    }
  }, [
    applyFlagsResults, hasFilteredSearchCriteria, queueFilteredSearchRefresh, reportError,
    requestMessageFlagMutation
  ]);

  const applyBulkFlagResults = useCallback((
    messages: Message[],
    results: Array<{ messageId: string; flags: string[] }>,
    flag: SystemFlag | null,
    source: string
  ) => {
    const flagsByMessageId = new Map(results.map((r) => [r.messageId, r.flags]));
    const pairs = messages
      .map((message) => {
        const nextFlags = flagsByMessageId.get(message.id);
        return nextFlags ? { message, nextFlags } : null;
      })
      .filter((pair): pair is { message: Message; nextFlags: string[] } => pair !== null);
    applyFlagsResults(pairs, flag, source);
  }, [applyFlagsResults]);

  const updateFlagStateBulk = useCallback(async (
    messages: Message[],
    flag: SystemFlag,
    value: boolean
  ) => {
    if (messages.length === 0) return;
    try {
      const results = await requestBulkFlagMutation(messages.map((m) => m.id), { flag, value });
      if (!results) return;
      applyBulkFlagResults(messages, results, flag, "update-flag-state-bulk");
      queueFilteredSearchRefresh(hasFilteredSearchCriteria);
    } catch {
      reportError("Failed to update message flag.");
    }
  }, [
    applyBulkFlagResults, hasFilteredSearchCriteria, queueFilteredSearchRefresh, reportError,
    requestBulkFlagMutation
  ]);

  const updateKeywordFlagBulk = useCallback(async (
    messages: Message[],
    keyword: string,
    value: boolean
  ) => {
    if (messages.length === 0) return;
    try {
      const results = await requestBulkFlagMutation(messages.map((m) => m.id), { keyword, value });
      if (!results) return;
      applyBulkFlagResults(messages, results, null, "update-keyword-flag-bulk");
      queueFilteredSearchRefresh(hasFilteredSearchCriteria);
    } catch {
      reportError("Failed to update message keyword.");
    }
  }, [
    applyBulkFlagResults, hasFilteredSearchCriteria, queueFilteredSearchRefresh, reportError,
    requestBulkFlagMutation
  ]);

  const handleSetCategory = useCallback(async (
    message: Message,
    category: "newsletter" | "notification" | "transactional" | null
  ) => {
    setPendingMessageActions((prev) => new Set(prev).add(message.id));
    try {
      const res = await apiFetch(buildAccountMessageActionPath(activeAccountId, message.id, "category"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }

      const data = (await res.json()) as {
        ok: boolean;
        message?: Message;
        previousCategory?: string | null;
        nextCategory?: string | null;
      };
      const updated = data.message;
      if (!updated) return;

      const shouldKeepUpdatedMessage = shouldKeepMessageInCurrentResults(updated);
      const applyCategoryPatch = (item: Message): Message => ({
        ...item,
        category: updated.category ?? null,
        categoryScore:
          typeof updated.categoryScore === "number" ? updated.categoryScore : null,
        categorySignals: updated.categorySignals ?? []
      });
      updateMessagesWithCurrentResultPrune(
        (item) => (item.id === message.id ? applyCategoryPatch(item) : item),
        { source: "set-category" }
      );
      setActiveTopicSuggestionMessages((prev) => {
        if (!prev.some((item) => item.id === message.id)) return prev;
        return prev.map((item) =>
          item.id === message.id ? applyCategoryPatch(item) : item
        );
      });
      updateThreadCacheWithCategory(
        message.id,
        updated.category ?? null,
        typeof updated.categoryScore === "number" ? updated.categoryScore : null,
        updated.categorySignals ?? []
      );
      if (viewMessage?.id === message.id && !shouldKeepUpdatedMessage) {
        setViewMessage(null);
        setActiveMessageId("");
      }
      queueFilteredSearchRefresh(hasFilteredSearchCriteria);
      pushNotice({
        type: "success",
        title: category ? "Category updated." : "Category removed.",
        description: getMessageSubjectForNotice(message)
      });
    } catch {
      reportError("Failed to update category.");
    } finally {
      setPendingMessageActions((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
    }
  }, [
    activeAccountId, apiFetch, hasFilteredSearchCriteria, pushNotice, queueFilteredSearchRefresh, readErrorMessage,
    reportError, setActiveMessageId, setActiveTopicSuggestionMessages, setPendingMessageActions, setViewMessage,
    shouldKeepMessageInCurrentResults, updateMessagesWithCurrentResultPrune, updateThreadCacheWithCategory,
    viewMessage?.id
  ]);

  const transitionTodoState = useCallback(async (
    msg: Message,
    fromKeyword: string,
    toKeyword: string
  ): Promise<void> => {
    const removeFlags = await requestMessageFlagMutation(msg.id, {
      keyword: fromKeyword,
      value: false
    });
    if (!removeFlags) return;

    const finalFlags = await requestMessageFlagMutation(msg.id, {
      keyword: toKeyword,
      value: true
    });
    if (!finalFlags) return;

    reconcileMessageFlags(msg, finalFlags, "transition-todo-state");
  }, [
    reconcileMessageFlags,
    requestMessageFlagMutation
  ]);

  const clearTodoFlag = useCallback(async (message: Message) => {
    await updateKeywordFlag(message, TODO_FLAG, false);
  }, [updateKeywordFlag]);

  const toggleTodoFlag = useCallback(async (
    message: Message,
    collapsedThreadMessages?: Message[],
    clickedBadge?: "todo" | "done"
  ) => {
    try {
      if (collapsedThreadMessages && collapsedThreadMessages.length > 0 && clickedBadge) {
        if (clickedBadge === "todo") {
          const todoMessages = collapsedThreadMessages.filter((m) => hasTodoFlag(m));
          if (todoMessages.length > 0) {
            await Promise.all(
              todoMessages.map((m) => transitionTodoState(m, TODO_FLAG, DONE_FLAG))
            );
            queueFilteredSearchRefresh(hasFilteredSearchCriteria);
          }
        } else if (clickedBadge === "done") {
          const doneMessages = collapsedThreadMessages.filter((m) => hasDoneFlag(m));
          if (doneMessages.length > 0) {
            await Promise.all(
              doneMessages.map((m) => transitionTodoState(m, DONE_FLAG, TODO_FLAG))
            );
            queueFilteredSearchRefresh(hasFilteredSearchCriteria);
          }
        }
        return;
      }

      const hasTodo = hasTodoFlag(message);
      const hasDone = hasDoneFlag(message);
    
      let finalFlags = message.flags ?? [];
      
      if (hasTodo) {
        const removeFlags = await requestMessageFlagMutation(message.id, {
          keyword: TODO_FLAG,
          value: false
        });
        if (!removeFlags) return;

        const addFlags = await requestMessageFlagMutation(message.id, {
          keyword: DONE_FLAG,
          value: true
        });
        if (!addFlags) return;
        finalFlags = addFlags;
      } else if (hasDone) {
        const removeFlags = await requestMessageFlagMutation(message.id, {
          keyword: DONE_FLAG,
          value: false
        });
        if (!removeFlags) return;

        const addFlags = await requestMessageFlagMutation(message.id, {
          keyword: TODO_FLAG,
          value: true
        });
        if (!addFlags) return;
        finalFlags = addFlags;
      } else {
        const flags = await requestMessageFlagMutation(message.id, {
          keyword: TODO_FLAG,
          value: true
        });
        if (!flags) return;
        finalFlags = flags;
      }
      
      reconcileMessageFlags(message, finalFlags, "toggle-todo-flag");
      queueFilteredSearchRefresh(hasFilteredSearchCriteria);
    } catch {
      reportError("Failed to update To-Do flag.");
    }
  }, [
    hasFilteredSearchCriteria, queueFilteredSearchRefresh, reconcileMessageFlags, reportError,
    requestMessageFlagMutation, transitionTodoState
  ]);

  const toggleFlaggedFlag = useCallback(async (
    message: Message,
    collapsedThreadMessages?: Message[]
  ) => {
    if (collapsedThreadMessages && collapsedThreadMessages.length > 0) {
      const flaggedMessages = collapsedThreadMessages.filter((m) => isFlaggedMessage(m));
      if (flaggedMessages.length > 0) {
        await Promise.all(
          flaggedMessages.map((m) => updateFlagState(m, "flagged", false))
        );
      }
      return;
    }
    await updateFlagState(message, "flagged", !isFlaggedMessage(message));
  }, [updateFlagState]);

  return {
    handleArchiveMessage,
    handleUnsubscribe,
    handleMarkSpam,
    handleMarkNotSpam,
    updateFlagState,
    updateFlagStateBulk,
    updateKeywordFlag,
    updateKeywordFlagBulk,
    handleSetCategory,
    transitionTodoState,
    clearTodoFlag,
    toggleTodoFlag,
    toggleFlaggedFlag
  };
}
