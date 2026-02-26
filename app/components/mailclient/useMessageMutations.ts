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
        previousMessageId?: string;
        messageId?: string;
      };
      const movedMessageId = data.messageId ?? message.id;
      evictMessageCaches(
        Array.from(new Set([message.id, movedMessageId]))
      );
      const shouldKeepArchivedMessage =
        searchScope === "all" &&
        Boolean(data.archiveFolderId) &&
        shouldKeepMessageInCurrentResults(
          remapMessageReferenceIds(
            {
              ...message,
              id: movedMessageId,
              folderId: data.archiveFolderId!
            },
            message.id,
            movedMessageId
          )
        );
      updateMessagesWithCurrentResultPrune((item) => {
        if (item.id !== message.id) return item;
        if (searchScope === "all" && data.archiveFolderId) {
          return remapMessageReferenceIds(
            { ...item, id: movedMessageId, folderId: data.archiveFolderId! },
            item.id,
            movedMessageId
          );
        }
        return null;
      }, { source: "archive-message" });
      if (viewMessage?.id === message.id) {
        if (!shouldKeepArchivedMessage) {
          setViewMessage(null);
          setActiveMessageId("");
        } else if (movedMessageId !== message.id) {
          setViewMessage({ ...message, id: movedMessageId, folderId: data.archiveFolderId! });
          setActiveMessageId(movedMessageId);
        }
      }
      const undoTarget: UndoMoveTarget = {
        messageId: movedMessageId,
        restoreFolderId: message.folderId
      };
      pushNotice({
        type: "success",
        title: "Message archived.",
        description: getMessageSubjectForNotice(message),
        actionLabel: data.archiveFolderId ? "Undo" : undefined,
        onAction:
          data.archiveFolderId
            ? () => undoMoveOperation([undoTarget], activeAccountId, "Archive undone.")
            : undefined,
        durationMs: data.archiveFolderId ? 12000 : NOTICE_TIMEOUTS.success
      });
    } catch {
      reportError("Failed to archive message.");
    }
  }, [
    activeAccountId, apiFetch, applyMoveReconcileSuppression, evictMessageCaches, pushNotice, readErrorMessage,
    reportError, searchScope, setActiveMessageId, setViewMessage, shouldKeepMessageInCurrentResults,
    undoMoveOperation, updateMessagesWithCurrentResultPrune, viewMessage?.id
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
      const movedMessageId = data.messageId ?? message.id;
      evictMessageCaches(
        Array.from(new Set([message.id, movedMessageId]))
      );
      const movedSpamMessage =
        searchScope === "all" && data.junkFolderId
          ? remapMessageReferenceIds(
              applyFlagsToMessage(
                {
                  ...message,
                  id: movedMessageId,
                  folderId: data.junkFolderId!,
                  mailboxPath: data.junkMailbox ?? message.mailboxPath
                },
                data.flags ?? message.flags ?? []
              ),
              message.id,
              movedMessageId
            )
          : null;
      updateMessagesWithCurrentResultPrune((item) => {
        if (item.id !== message.id) return item;
        if (searchScope === "all" && data.junkFolderId) {
          return remapMessageReferenceIds(
            applyFlagsToMessage(
              {
                ...item,
                id: movedMessageId,
                folderId: data.junkFolderId!,
                mailboxPath: data.junkMailbox ?? item.mailboxPath
              },
              data.flags ?? item.flags ?? []
            ),
            item.id,
            movedMessageId
          );
        }
        return null;
      }, { source: "mark-spam" });
      if (viewMessage?.id === message.id) {
        if (!movedSpamMessage || !shouldKeepMessageInCurrentResults(movedSpamMessage)) {
          setViewMessage(null);
          setActiveMessageId("");
        } else if (movedMessageId !== message.id) {
          setViewMessage(movedSpamMessage);
          setActiveMessageId(movedMessageId);
        }
      }
      const undoTarget: UndoMoveTarget = {
        messageId: movedMessageId,
        restoreFolderId: message.folderId
      };
      pushNotice({
        type: "success",
        title: "Message marked as spam.",
        description: getMessageSubjectForNotice(message),
        actionLabel: data.junkFolderId ? "Undo" : undefined,
        onAction:
          data.junkFolderId
            ? () => undoMoveOperation([undoTarget], activeAccountId, "Spam action undone.")
            : undefined,
        durationMs: data.junkFolderId ? 12000 : NOTICE_TIMEOUTS.success
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
    activeAccountId, apiFetch, applyMoveReconcileSuppression, evictMessageCaches, pushNotice, readErrorMessage,
    reportError, searchScope, setActiveMessageId, setPendingMessageActions, setViewMessage,
    shouldKeepMessageInCurrentResults, undoMoveOperation, updateMessagesWithCurrentResultPrune, viewMessage?.id
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
      const movedMessageId = data.messageId ?? message.id;
      evictMessageCaches(
        Array.from(new Set([message.id, movedMessageId]))
      );
      const movedInboxMessage =
        searchScope === "all" && data.inboxFolderId
          ? remapMessageReferenceIds(
              applyFlagsToMessage(
                {
                  ...message,
                  id: movedMessageId,
                  folderId: data.inboxFolderId!,
                  mailboxPath: data.inboxMailbox ?? message.mailboxPath
                },
                data.flags ?? message.flags ?? []
              ),
              message.id,
              movedMessageId
            )
          : null;
      updateMessagesWithCurrentResultPrune((item) => {
        if (item.id !== message.id) return item;
        if (searchScope === "all" && data.inboxFolderId) {
          return remapMessageReferenceIds(
            applyFlagsToMessage(
              {
                ...item,
                id: movedMessageId,
                folderId: data.inboxFolderId!,
                mailboxPath: data.inboxMailbox ?? item.mailboxPath
              },
              data.flags ?? item.flags ?? []
            ),
            item.id,
            movedMessageId
          );
        }
        return null;
      }, { source: "mark-not-spam" });
      if (viewMessage?.id === message.id) {
        if (!movedInboxMessage || !shouldKeepMessageInCurrentResults(movedInboxMessage)) {
          setViewMessage(null);
          setActiveMessageId("");
        } else if (movedMessageId !== message.id) {
          setViewMessage(movedInboxMessage);
          setActiveMessageId(movedMessageId);
        }
      }
      const undoTarget: UndoMoveTarget = {
        messageId: movedMessageId,
        restoreFolderId: message.folderId
      };
      pushNotice({
        type: "success",
        title: "Message marked as not spam.",
        description: getMessageSubjectForNotice(message),
        actionLabel: data.inboxFolderId ? "Undo" : undefined,
        onAction:
          data.inboxFolderId
            ? () => undoMoveOperation([undoTarget], activeAccountId, "Not-spam action undone.")
            : undefined,
        durationMs: data.inboxFolderId ? 12000 : NOTICE_TIMEOUTS.success
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
    activeAccountId, apiFetch, applyMoveReconcileSuppression, evictMessageCaches, pushNotice, readErrorMessage,
    reportError, searchScope, setActiveMessageId, setPendingMessageActions, setViewMessage,
    shouldKeepMessageInCurrentResults, undoMoveOperation, updateMessagesWithCurrentResultPrune, viewMessage?.id
  ]);

  const updateFlagState = useCallback(async (
    message: Message,
    flag: "seen" | "answered" | "flagged" | "draft" | "deleted",
    value: boolean
  ) => {
    try {
      const res = await apiFetch("/api/message/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: activeAccountId,
          messageId: message.id,
          flag,
          value
        })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as { flags: string[] };
      const updatedMessage = applyFlagsToMessage(message, data.flags);
      const shouldKeepUpdatedMessage = shouldKeepMessageInCurrentResults(updatedMessage);
      updateMessagesWithCurrentResultPrune(
        (item) => (item.id === message.id ? applyFlagsToMessage(item, data.flags) : item),
        { source: "update-flag-state" }
      );
      updateThreadCacheWithFlags(message.id, data.flags);
      if (flag === "seen") {
        const nextSeen = Boolean(updatedMessage.seen);
        setFolders((prev) =>
          prev.map((folder) => {
            if (folder.id !== message.folderId) return folder;
            const unreadCount = folder.unreadCount ?? 0;
            if (message.seen && !nextSeen) {
              return { ...folder, unreadCount: unreadCount + 1 };
            }
            if (!message.seen && nextSeen) {
              return { ...folder, unreadCount: Math.max(0, unreadCount - 1) };
            }
            return folder;
          })
        );
      }
      if (viewMessage?.id === message.id && !shouldKeepUpdatedMessage) {
        setViewMessage(null);
        setActiveMessageId("");
      }
      queueFilteredSearchRefresh(hasFilteredSearchCriteria);
    } catch {
      reportError("Failed to update message flag.");
    }
  }, [
    activeAccountId, apiFetch, hasFilteredSearchCriteria, queueFilteredSearchRefresh, readErrorMessage, reportError,
    setActiveMessageId, setFolders, setViewMessage, shouldKeepMessageInCurrentResults, updateMessagesWithCurrentResultPrune,
    updateThreadCacheWithFlags, viewMessage?.id
  ]);

  const updateKeywordFlag = useCallback(async (
    message: Message,
    keyword: string,
    value: boolean
  ) => {
    try {
      const res = await apiFetch("/api/message/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: activeAccountId,
          messageId: message.id,
          keyword,
          value
        })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      const data = (await res.json()) as { flags: string[] };
      const updatedMessage = applyFlagsToMessage(message, data.flags);
      const shouldKeepUpdatedMessage = shouldKeepMessageInCurrentResults(updatedMessage);
      updateMessagesWithCurrentResultPrune(
        (item) => (item.id === message.id ? applyFlagsToMessage(item, data.flags) : item),
        { source: "update-keyword-flag" }
      );
      updateThreadCacheWithFlags(message.id, data.flags);
      if (viewMessage?.id === message.id && !shouldKeepUpdatedMessage) {
        setViewMessage(null);
        setActiveMessageId("");
      }
      queueFilteredSearchRefresh(hasFilteredSearchCriteria);
    } catch {
      reportError("Failed to update message keyword.");
    }
  }, [
    activeAccountId, apiFetch, hasFilteredSearchCriteria, queueFilteredSearchRefresh, readErrorMessage, reportError,
    setActiveMessageId, setViewMessage, shouldKeepMessageInCurrentResults, updateMessagesWithCurrentResultPrune,
    updateThreadCacheWithFlags, viewMessage?.id
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
    const removeRes = await apiFetch("/api/message/flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: activeAccountId,
        messageId: msg.id,
        keyword: fromKeyword,
        value: false
      })
    });
    if (!removeRes.ok) {
      reportError(await readErrorMessage(removeRes));
      return;
    }
    await removeRes.json();

    const addRes = await apiFetch("/api/message/flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: activeAccountId,
        messageId: msg.id,
        keyword: toKeyword,
        value: true
      })
    });
    if (!addRes.ok) {
      reportError(await readErrorMessage(addRes));
      return;
    }
    const addData = (await addRes.json()) as { flags: string[] };
    const finalFlags = addData.flags;
    
    const updatedMessage = applyFlagsToMessage(msg, finalFlags);
    const shouldKeepUpdatedMessage = shouldKeepMessageInCurrentResults(updatedMessage);
    updateMessagesWithCurrentResultPrune(
      (item) => (item.id === msg.id ? applyFlagsToMessage(item, finalFlags) : item),
      { source: "transition-todo-state" }
    );
    updateThreadCacheWithFlags(msg.id, finalFlags);
    if (viewMessage?.id === msg.id && !shouldKeepUpdatedMessage) {
      setViewMessage(null);
      setActiveMessageId("");
    }
  }, [
    activeAccountId, apiFetch, readErrorMessage, reportError, setActiveMessageId, setViewMessage,
    shouldKeepMessageInCurrentResults, updateMessagesWithCurrentResultPrune, updateThreadCacheWithFlags, viewMessage?.id
  ]);

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
        const removeRes = await apiFetch("/api/message/flags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            messageId: message.id,
            keyword: TODO_FLAG,
            value: false
          })
        });
        if (!removeRes.ok) {
          reportError(await readErrorMessage(removeRes));
          return;
        }
        const removeData = (await removeRes.json()) as { flags: string[] };
        finalFlags = removeData.flags;
        
        const addRes = await apiFetch("/api/message/flags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            messageId: message.id,
            keyword: DONE_FLAG,
            value: true
          })
        });
        if (!addRes.ok) {
          reportError(await readErrorMessage(addRes));
          return;
        }
        const addData = (await addRes.json()) as { flags: string[] };
        finalFlags = addData.flags;
      } else if (hasDone) {
        const removeRes = await apiFetch("/api/message/flags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            messageId: message.id,
            keyword: DONE_FLAG,
            value: false
          })
        });
        if (!removeRes.ok) {
          reportError(await readErrorMessage(removeRes));
          return;
        }
        const removeData = (await removeRes.json()) as { flags: string[] };
        finalFlags = removeData.flags;
        
        const addRes = await apiFetch("/api/message/flags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            messageId: message.id,
            keyword: TODO_FLAG,
            value: true
          })
        });
        if (!addRes.ok) {
          reportError(await readErrorMessage(addRes));
          return;
        }
        const addData = (await addRes.json()) as { flags: string[] };
        finalFlags = addData.flags;
      } else {
        const res = await apiFetch("/api/message/flags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            messageId: message.id,
            keyword: TODO_FLAG,
            value: true
          })
        });
        if (!res.ok) {
          reportError(await readErrorMessage(res));
          return;
        }
        const data = (await res.json()) as { flags: string[] };
        finalFlags = data.flags;
      }
      
      const updatedMessage = applyFlagsToMessage(message, finalFlags);
      const shouldKeepUpdatedMessage = shouldKeepMessageInCurrentResults(updatedMessage);
      updateMessagesWithCurrentResultPrune(
        (item) => (item.id === message.id ? applyFlagsToMessage(item, finalFlags) : item),
        { source: "toggle-todo-flag" }
      );
      updateThreadCacheWithFlags(message.id, finalFlags);
      if (viewMessage?.id === message.id && !shouldKeepUpdatedMessage) {
        setViewMessage(null);
        setActiveMessageId("");
      }
      queueFilteredSearchRefresh(hasFilteredSearchCriteria);
    } catch {
      reportError("Failed to update To-Do flag.");
    }
  }, [
    activeAccountId, apiFetch, hasFilteredSearchCriteria, queueFilteredSearchRefresh, readErrorMessage, reportError,
    setActiveMessageId, setViewMessage, shouldKeepMessageInCurrentResults, transitionTodoState,
    updateMessagesWithCurrentResultPrune, updateThreadCacheWithFlags, viewMessage?.id
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
    toggleTodoFlag,
    toggleFlaggedFlag
  };
}
