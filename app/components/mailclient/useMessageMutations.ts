import { useCallback } from "react";
import type { Message } from "@/lib/data";
import { applyFlagsToMessage, isFlaggedMessage, hasTodoFlag, hasDoneFlag, getUnsubscribeCapability } from "./utils/messageHelpers";
import { getMessageSubjectForNotice, remapMessageReferenceIds } from "./utils/messageMutation";
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
  reportError: (message: string) => void;
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
    updateThreadCacheWithFlags(message.id, flags);
    if (viewMessage?.id === message.id && !shouldKeepUpdatedMessage) {
      setViewMessage(null);
      setActiveMessageId("");
    }
    return updatedMessage;
  }, [
    setActiveMessageId,
    setViewMessage,
    shouldKeepMessageInCurrentResults,
    updateMessagesWithCurrentResultPrune,
    updateThreadCacheWithFlags,
    viewMessage?.id
  ]);

  const requestMessageFlagMutation = useCallback(async (
    messageId: string,
    payload: { value: boolean; flag?: SystemFlag; keyword?: string }
  ) => {
    const res = await apiFetch("/api/message/flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: activeAccountId,
        messageId,
        ...payload
      })
    });
    if (!res.ok) {
      reportError(await readErrorMessage(res));
      return null;
    }
    const data = (await res.json()) as { flags?: string[] };
    return data.flags ?? [];
  }, [activeAccountId, apiFetch, readErrorMessage, reportError]);

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

    const movedMessage =
      searchScope === "all" && destinationFolderId
        ? remapMessageReferenceIds(
            applyFlagsToMessage(
              {
                ...message,
                id: movedMessageId,
                folderId: destinationFolderId,
                mailboxPath: destinationMailbox ?? message.mailboxPath
              },
              flags ?? message.flags ?? []
            ),
            message.id,
            movedMessageId
          )
        : null;

    updateMessagesWithCurrentResultPrune((item) => {
      if (item.id !== message.id) return item;
      if (searchScope === "all" && destinationFolderId) {
        return remapMessageReferenceIds(
          applyFlagsToMessage(
            {
              ...item,
              id: movedMessageId,
              folderId: destinationFolderId,
              mailboxPath: destinationMailbox ?? item.mailboxPath
            },
            flags ?? item.flags ?? []
          ),
          item.id,
          movedMessageId
        );
      }
      return null;
    }, { source });

    if (viewMessage?.id === message.id) {
      if (!movedMessage || !shouldKeepMessageInCurrentResults(movedMessage)) {
        setViewMessage(null);
        setActiveMessageId("");
      } else if (movedMessageId !== message.id) {
        setViewMessage(movedMessage);
        setActiveMessageId(movedMessageId);
      }
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
      const res = await apiFetch("/api/message/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId, messageId: message.id })
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
        const res = await apiFetch("/api/message/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            messageId: message.id
          })
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
      const res = await apiFetch("/api/message/spam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId, messageId: message.id })
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
      const res = await apiFetch("/api/message/not-spam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId, messageId: message.id })
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

  const updateFlagState = useCallback(async (
    message: Message,
    flag: SystemFlag,
    value: boolean
  ) => {
    try {
      const flags = await requestMessageFlagMutation(message.id, { flag, value });
      if (!flags) return;
      const updatedMessage = reconcileMessageFlags(message, flags, "update-flag-state");
      const previousSeen = Boolean(message.seen);
      const nextSeen = Boolean(updatedMessage.seen);
      if (previousSeen !== nextSeen) {
        setFolders((prev) =>
          prev.map((folder) => {
            if (folder.id !== message.folderId) return folder;
            const unreadCount = folder.unreadCount ?? 0;
            if (previousSeen && !nextSeen) {
              return { ...folder, unreadCount: unreadCount + 1 };
            }
            if (!previousSeen && nextSeen) {
              return { ...folder, unreadCount: Math.max(0, unreadCount - 1) };
            }
            return folder;
          })
        );
      }
      queueFilteredSearchRefresh(hasFilteredSearchCriteria);
    } catch {
      reportError("Failed to update message flag.");
    }
  }, [
    hasFilteredSearchCriteria, queueFilteredSearchRefresh, reconcileMessageFlags, reportError,
    requestMessageFlagMutation, setFolders
  ]);

  const updateKeywordFlag = useCallback(async (
    message: Message,
    keyword: string,
    value: boolean
  ) => {
    try {
      const flags = await requestMessageFlagMutation(message.id, { keyword, value });
      if (!flags) return;
      reconcileMessageFlags(message, flags, "update-keyword-flag");
      queueFilteredSearchRefresh(hasFilteredSearchCriteria);
    } catch {
      reportError("Failed to update message keyword.");
    }
  }, [
    hasFilteredSearchCriteria, queueFilteredSearchRefresh, reconcileMessageFlags, reportError,
    requestMessageFlagMutation
  ]);

  const handleSetCategory = useCallback(async (
    message: Message,
    category: "newsletter" | "notification" | "transactional" | null
  ) => {
    setPendingMessageActions((prev) => new Set(prev).add(message.id));
    try {
      const res = await apiFetch("/api/message/category", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: activeAccountId,
          messageId: message.id,
          category
        })
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
      updateMessagesWithCurrentResultPrune(
        (item) =>
          item.id === message.id
            ? {
                ...item,
                category: updated.category ?? null,
                categoryScore:
                  typeof updated.categoryScore === "number" ? updated.categoryScore : null,
                categorySignals: updated.categorySignals ?? []
              }
            : item,
        { source: "set-category" }
      );
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
    reportError, setActiveMessageId, setPendingMessageActions, setViewMessage, shouldKeepMessageInCurrentResults,
    updateMessagesWithCurrentResultPrune, updateThreadCacheWithCategory, viewMessage?.id
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
    updateKeywordFlag,
    handleSetCategory,
    transitionTodoState,
    clearTodoFlag,
    toggleTodoFlag,
    toggleFlaggedFlag
  };
}
