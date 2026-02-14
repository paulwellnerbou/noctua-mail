"use client";

import type React from "react";
import { useCallback } from "react";
import type { Folder, Message } from "@/lib/data";
import type { SelectionStore } from "./messagelist/selectionStore";
import type { MoveMessagesToFolder, UndoMoveTarget } from "./useMessageMoveActions";

type DeleteResponse = {
  action: "deleted" | "moved";
  trashFolderId?: string | null;
  messageId?: string;
  previousMessageId?: string;
};

type BulkDeleteResponse = {
  action: "deleted";
  deleted?: number;
  deletedIds?: string[];
};

type DeleteNoticeInput = {
  type: "success";
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number | null;
};

type ConfirmThreadDeleteInput = {
  messageCount: number;
  moveToTrashCount: number;
  permanentDeleteCount: number;
};

type UseMessageDeleteActionsOptions = {
  activeAccountId: string;
  activeMessageId: string;
  supportsThreads: boolean;
  collapsedThreads: Record<string, boolean>;
  searchScope: "folder" | "all";
  folders: Folder[];
  messages: Message[];
  threadScopeMessages: Message[];
  visibleMessages: Array<{ message: Message; threadId: string }>;
  sortedMessages: Message[];
  isTrashFolder: (folderId?: string | null) => boolean;
  moveMessagesToFolder: MoveMessagesToFolder;
  selectionStore: SelectionStore;
  lastSelectedIdRef: React.MutableRefObject<string | null>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  shouldKeepMessageInResults?: (message: Message) => boolean;
  setPendingMessageActions: React.Dispatch<React.SetStateAction<Set<string>>>;
  setActiveMessageId: React.Dispatch<React.SetStateAction<string>>;
  refreshFolders: () => Promise<unknown>;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readErrorMessage: (res: Response) => Promise<string>;
  reportError: (message: string) => void;
  pushNotice: (input: DeleteNoticeInput) => void;
  confirmThreadDelete: (input: ConfirmThreadDeleteInput) => Promise<boolean>;
  undoMoveOperation: (
    targets: UndoMoveTarget[],
    accountId: string,
    successTitle?: string
  ) => Promise<void>;
  noticeSuccessTimeout: number;
  onMessagesRemoved?: (messageIds: string[]) => void;
  markMessagesMutated?: () => void;
  markDeleteReconcileSuppression?: (targets: Message[]) => void;
};

export function useMessageDeleteActions({
  activeAccountId,
  activeMessageId,
  supportsThreads,
  collapsedThreads,
  searchScope,
  folders,
  messages,
  threadScopeMessages,
  visibleMessages,
  sortedMessages,
  isTrashFolder,
  moveMessagesToFolder,
  selectionStore,
  lastSelectedIdRef,
  setMessages,
  shouldKeepMessageInResults,
  setPendingMessageActions,
  setActiveMessageId,
  refreshFolders,
  apiFetch,
  readErrorMessage,
  reportError,
  pushNotice,
  confirmThreadDelete,
  undoMoveOperation,
  noticeSuccessTimeout,
  onMessagesRemoved,
  markMessagesMutated,
  markDeleteReconcileSuppression
}: UseMessageDeleteActionsOptions) {
  const isPermanentDeleteTarget = useCallback(
    (target: Message, trashFolderId: string | null) => {
      if (trashFolderId && target.folderId === trashFolderId) return true;
      return isTrashFolder(target.folderId);
    },
    [isTrashFolder]
  );

  const getMessageSubjectForNotice = useCallback(
    (message?: Message | null) => message?.subject?.trim() || "(no subject)",
    []
  );

  const clearSelectionState = useCallback(() => {
    selectionStore.clearSelection();
    lastSelectedIdRef.current = null;
  }, [lastSelectedIdRef, selectionStore]);

  const findTrashFolderId = useCallback(() => {
    const candidates = folders.filter((folder) => folder.accountId === activeAccountId);
    const bySpecialUse = candidates.find((folder) => (folder.specialUse ?? "").toLowerCase() === "\\trash");
    return bySpecialUse?.id ?? null;
  }, [activeAccountId, folders]);

  const deleteSingleMessagePermanently = useCallback(
    async (target: Message) => {
      const res = await apiFetch("/api/message/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId, messageId: target.id })
      });
      if (!res.ok) {
        const errorMessage = await readErrorMessage(res);
        throw new Error(errorMessage || "Failed to delete message.");
      }
      const data = (await res.json()) as DeleteResponse;
      const movedMessageId = data.messageId ?? target.id;
      markMessagesMutated?.();
      setMessages((prev) => {
        if (data.action === "deleted" || !data.trashFolderId) {
          return prev.filter((item) => item.id !== target.id);
        }
        if (data.action === "moved") {
          if (!(searchScope === "all" && data.trashFolderId)) {
            return prev.filter((item) => item.id !== target.id);
          }
          return prev.flatMap((item) => {
            if (item.id !== target.id) return [item];
            const updated = {
              ...item,
              id: movedMessageId,
              folderId: data.trashFolderId!,
              recent: false
            };
            const keep = shouldKeepMessageInResults
              ? shouldKeepMessageInResults(updated)
              : true;
            return keep ? [updated] : [];
          });
        }
        return prev;
      });
      return data;
    },
    [
      activeAccountId,
      apiFetch,
      markMessagesMutated,
      readErrorMessage,
      searchScope,
      setMessages,
      shouldKeepMessageInResults
    ]
  );

  const deleteMessagesPermanently = useCallback(
    async (targets: Message[]) => {
      const uniqueIds = Array.from(new Set(targets.map((target) => target.id).filter(Boolean)));
      if (uniqueIds.length === 0) return [] as string[];
      if (uniqueIds.length === 1) {
        const single = targets[0];
        const result = await deleteSingleMessagePermanently(single);
        return result.action === "deleted" ? [single.id] : [];
      }
      const res = await apiFetch("/api/message/delete/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: activeAccountId, messageIds: uniqueIds })
      });
      if (!res.ok) {
        const errorMessage = await readErrorMessage(res);
        throw new Error(errorMessage || "Failed to delete messages.");
      }
      const data = (await res.json()) as BulkDeleteResponse;
      const deletedIds = new Set((data.deletedIds ?? []).filter(Boolean));
      markMessagesMutated?.();
      setMessages((prev) => prev.filter((item) => !deletedIds.has(item.id)));
      return uniqueIds.filter((id) => deletedIds.has(id));
    },
    [
      activeAccountId,
      apiFetch,
      deleteSingleMessagePermanently,
      markMessagesMutated,
      readErrorMessage,
      setMessages
    ]
  );

  const pushDeleteNotice = useCallback(
    (
      movedToTrashCount: number,
      permanentlyDeletedCount: number,
      undoTargets: UndoMoveTarget[],
      singleSubject?: string
    ) => {
      if (movedToTrashCount > 0) {
        pushNotice({
          type: "success",
          title:
            movedToTrashCount === 1
              ? "Moved message to Trash."
              : `Moved ${movedToTrashCount} messages to Trash.`,
          description:
            permanentlyDeletedCount > 0
              ? permanentlyDeletedCount === 1
                ? "1 message was deleted permanently."
                : `${permanentlyDeletedCount} messages were deleted permanently.`
              : singleSubject,
          actionLabel: undoTargets.length > 0 ? "Undo" : undefined,
          onAction:
            undoTargets.length > 0
              ? () =>
                  void undoMoveOperation(
                    undoTargets,
                    activeAccountId,
                    undoTargets.length === 1 ? "Message restored." : "Messages restored."
                  )
              : undefined,
          durationMs: undoTargets.length > 0 ? 12000 : noticeSuccessTimeout
        });
        return;
      }
      if (permanentlyDeletedCount > 0) {
        pushNotice({
          type: "success",
          title:
            permanentlyDeletedCount === 1
              ? "Message deleted permanently."
              : `${permanentlyDeletedCount} messages deleted permanently.`,
          description: permanentlyDeletedCount === 1 ? singleSubject : undefined
        });
      }
    },
    [activeAccountId, noticeSuccessTimeout, pushNotice, undoMoveOperation]
  );

  const resolveDeleteNextActiveId = useCallback(
    (targetIds: Set<string>, threadIdForFallback?: string) => {
      if (!activeMessageId || !targetIds.has(activeMessageId)) {
        return { activeWasDeleted: false, nextActiveId: "" };
      }
      let nextActiveId = (() => {
        const indices = visibleMessages
          .map((item, index) => (targetIds.has(item.message.id) ? index : -1))
          .filter((idx) => idx >= 0);
        if (indices.length === 0) return "";
        const maxIndex = Math.max(...indices);
        const minIndex = Math.min(...indices);
        for (let i = maxIndex + 1; i < visibleMessages.length; i += 1) {
          const candidate = visibleMessages[i]?.message?.id;
          if (candidate && !targetIds.has(candidate)) return candidate;
        }
        for (let i = minIndex - 1; i >= 0; i -= 1) {
          const candidate = visibleMessages[i]?.message?.id;
          if (candidate && !targetIds.has(candidate)) return candidate;
        }
        return "";
      })();
      if (threadIdForFallback && !nextActiveId) {
        const threadRoot = visibleMessages.find(
          (item) => item.threadId === threadIdForFallback
        )?.message.id;
        if (threadRoot && !targetIds.has(threadRoot)) {
          nextActiveId = threadRoot;
        }
      }
      if (!nextActiveId) {
        const fallback = sortedMessages.find((msg) => !targetIds.has(msg.id));
        if (fallback) nextActiveId = fallback.id;
      }
      return { activeWasDeleted: true, nextActiveId };
    },
    [activeMessageId, sortedMessages, visibleMessages]
  );

  const runDeleteTransaction = useCallback(
    async (
      targets: Message[],
      options: {
        errorMessage: string;
        threadIdForFallback?: string;
        clearSelectionWhenActiveRemains?: boolean;
      }
    ) => {
      if (targets.length === 0) return;
      markDeleteReconcileSuppression?.(targets);
      const targetIds = new Set(targets.map((item) => item.id));
      const { activeWasDeleted, nextActiveId } = resolveDeleteNextActiveId(
        targetIds,
        options.threadIdForFallback
      );
      const singleSubject =
        targets.length === 1 ? getMessageSubjectForNotice(targets[0]) : undefined;
      const undoTargets: UndoMoveTarget[] = [];
      let movedToTrashCount = 0;
      let permanentlyDeletedCount = 0;
      const removedIds: string[] = [];
      const trashFolderId = findTrashFolderId();
      const hardDeleteTargets = targets.filter((target) =>
        isPermanentDeleteTarget(target, trashFolderId)
      );
      const moveTargets = targets.filter(
        (target) => !isPermanentDeleteTarget(target, trashFolderId)
      );
      try {
        setPendingMessageActions((prev) => new Set([...prev, ...targets.map((t) => t.id)]));
        if (moveTargets.length > 0) {
          if (!trashFolderId) {
            reportError("Trash folder not found.");
            return;
          }
          const moveResult = await moveMessagesToFolder(trashFolderId, {
            messageIds: moveTargets.map((target) => target.id),
            showNotice: false,
            clearSelectionOnSuccess: false,
            managePendingState: false,
            updateActiveMessage: false
          });
          if (!moveResult) return;
          movedToTrashCount += moveResult.ids.length;
          undoTargets.push(...moveResult.undoTargets);
          removedIds.push(...moveResult.ids);
        }
        if (hardDeleteTargets.length > 0) {
          const deletedIds = await deleteMessagesPermanently(hardDeleteTargets);
          permanentlyDeletedCount += deletedIds.length;
          removedIds.push(...deletedIds);
        }
        if (activeWasDeleted) {
          if (nextActiveId) {
            setActiveMessageId(nextActiveId);
            selectionStore.setSelection(new Set([nextActiveId]), nextActiveId);
            lastSelectedIdRef.current = nextActiveId;
          } else {
            setActiveMessageId("");
            selectionStore.clearSelection();
          }
        } else if (options.clearSelectionWhenActiveRemains) {
          clearSelectionState();
        }
        await refreshFolders();
        pushDeleteNotice(movedToTrashCount, permanentlyDeletedCount, undoTargets, singleSubject);
        if (onMessagesRemoved && removedIds.length > 0) {
          onMessagesRemoved(removedIds);
        }
      } catch (error) {
        if (error instanceof Error && error.message) {
          reportError(error.message);
        } else {
          reportError(options.errorMessage);
        }
      } finally {
        setPendingMessageActions((prev) => {
          const next = new Set(prev);
          targets.forEach((item) => next.delete(item.id));
          return next;
        });
      }
    },
    [
      clearSelectionState,
      deleteMessagesPermanently,
      findTrashFolderId,
      getMessageSubjectForNotice,
      isPermanentDeleteTarget,
      lastSelectedIdRef,
      moveMessagesToFolder,
      pushDeleteNotice,
      refreshFolders,
      reportError,
      resolveDeleteNextActiveId,
      selectionStore,
      setActiveMessageId,
      setPendingMessageActions,
      onMessagesRemoved,
      markDeleteReconcileSuppression
    ]
  );

  const handleDeleteMessage = useCallback(
    async (message: Message, options?: { allowThreadDeletion?: boolean }) => {
      const allowThreadDeletion = options?.allowThreadDeletion ?? true;
      const getThreadKey = (item: Message) => item.threadId ?? item.messageId ?? item.id;
      const threadId = getThreadKey(message);
      const threadItems = supportsThreads
        ? threadScopeMessages.filter(
            (item) => item.accountId === activeAccountId && getThreadKey(item) === threadId
          )
        : [];
      const isCollapsedThread =
        allowThreadDeletion &&
        supportsThreads &&
        collapsedThreads[threadId] &&
        threadItems.length > 1;
      const targets = isCollapsedThread ? threadItems : [message];
      if (isCollapsedThread) {
        const trashFolderId = findTrashFolderId();
        const permanentDeleteCount = targets.filter((target) =>
          isPermanentDeleteTarget(target, trashFolderId)
        ).length;
        const moveToTrashCount = targets.length - permanentDeleteCount;
        const confirmed = await confirmThreadDelete({
          messageCount: threadItems.length,
          moveToTrashCount,
          permanentDeleteCount
        });
        if (!confirmed) return;
      }
      await runDeleteTransaction(targets, {
        errorMessage: "Failed to delete message.",
        threadIdForFallback: threadId
      });
    },
    [
      activeAccountId,
      collapsedThreads,
      confirmThreadDelete,
      findTrashFolderId,
      isPermanentDeleteTarget,
      runDeleteTransaction,
      supportsThreads,
      threadScopeMessages
    ]
  );

  const handleDeleteMessagesByIds = useCallback(
    async (messageIds: string[]) => {
      const uniqueIds = Array.from(new Set(messageIds));
      if (uniqueIds.length === 0) return;
      const targets = uniqueIds
        .map(
          (id) =>
            threadScopeMessages.find((item) => item.id === id) ??
            messages.find((item) => item.id === id)
        )
        .filter((message): message is Message => Boolean(message));
      await runDeleteTransaction(targets, {
        errorMessage: "Failed to delete messages.",
        clearSelectionWhenActiveRemains: true
      });
    },
    [messages, runDeleteTransaction, threadScopeMessages]
  );

  return {
    handleDeleteMessage,
    handleDeleteMessagesByIds
  };
}
