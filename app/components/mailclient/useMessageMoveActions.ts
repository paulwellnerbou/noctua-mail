"use client";

import type React from "react";
import { useCallback } from "react";
import type { Message } from "@/lib/data";
import type { SelectionStore } from "./messagelist/selectionStore";

export type UndoMoveTarget = {
  messageId: string;
  restoreFolderId: string;
};

type MoveNoticeInput = {
  type: "success";
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number | null;
};

type MoveApiResponse = {
  ok: boolean;
  destinationFolderId: string;
  destinationMailbox?: string;
};

export type MoveMessagesResult = {
  ids: string[];
  undoTargets: UndoMoveTarget[];
  destinationFolderId: string;
  destinationName: string;
  singleSubject?: string;
};

export type MoveMessagesOptions = {
  messageIds?: string[];
  showNotice?: boolean;
  clearSelectionOnSuccess?: boolean;
  managePendingState?: boolean;
  updateActiveMessage?: boolean;
  reportErrorOnFailure?: boolean;
};

export type MoveMessagesToFolder = (
  destinationFolderId: string,
  options?: MoveMessagesOptions
) => Promise<MoveMessagesResult | null>;

type UseMessageMoveActionsOptions = {
  activeAccountId: string;
  activeMessageId: string;
  activeFolderId: string;
  searchScope: "folder" | "all";
  messages: Message[];
  selectionStore: SelectionStore;
  folderById: Map<string, { name: string }>;
  lastSelectedIdRef: React.MutableRefObject<string | null>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setPendingMessageActions: React.Dispatch<React.SetStateAction<Set<string>>>;
  setActiveMessageId: React.Dispatch<React.SetStateAction<string>>;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readErrorMessage: (res: Response) => Promise<string>;
  reportError: (message: string) => void;
  pushNotice: (input: MoveNoticeInput) => void;
  undoMoveOperation: (
    targets: UndoMoveTarget[],
    accountId: string,
    successTitle?: string
  ) => Promise<void>;
  noticeSuccessTimeout: number;
  onMoveComplete?: (messageIds: string[]) => void;
};

export function useMessageMoveActions({
  activeAccountId,
  activeMessageId,
  activeFolderId,
  searchScope,
  messages,
  selectionStore,
  folderById,
  lastSelectedIdRef,
  setMessages,
  setPendingMessageActions,
  setActiveMessageId,
  apiFetch,
  readErrorMessage,
  reportError,
  pushNotice,
  undoMoveOperation,
  noticeSuccessTimeout,
  onMoveComplete
}: UseMessageMoveActionsOptions) {
  const getMessageSubjectForNotice = useCallback(
    (message?: Message | null) => message?.subject?.trim() || "(no subject)",
    []
  );

  const clearSelectionState = useCallback(() => {
    selectionStore.clearSelection();
    lastSelectedIdRef.current = null;
  }, [lastSelectedIdRef, selectionStore]);

  const moveMessagesToFolder = useCallback<MoveMessagesToFolder>(
    async (destinationFolderId, options) => {
      const selected = selectionStore.getIds();
      const ids =
        options?.messageIds && options.messageIds.length > 0
          ? options.messageIds
          : selected.size > 0
            ? Array.from(selected)
            : activeMessageId
              ? [activeMessageId]
              : [];
      if (!ids.length) return null;
      const uniqueIds = Array.from(new Set(ids));
      const idSet = new Set(uniqueIds);
      const undoTargets: UndoMoveTarget[] = messages
        .filter((item) => item.accountId === activeAccountId && idSet.has(item.id))
        .map((item) => ({
          messageId: item.id,
          restoreFolderId: item.folderId
        }));
      const singleTarget =
        uniqueIds.length === 1
          ? messages.find(
              (item) => item.accountId === activeAccountId && item.id === uniqueIds[0]
            ) ?? null
          : null;
      const singleSubject =
        uniqueIds.length === 1 ? getMessageSubjectForNotice(singleTarget) : undefined;
      const managePendingState = options?.managePendingState ?? true;
      const clearSelectionOnSuccess = options?.clearSelectionOnSuccess ?? true;
      const updateActiveMessage = options?.updateActiveMessage ?? true;
      const showNotice = options?.showNotice ?? true;
      const reportErrorOnFailure = options?.reportErrorOnFailure ?? true;
      try {
        if (managePendingState) {
          setPendingMessageActions((prev) => new Set([...prev, ...uniqueIds]));
        }
        const res = await apiFetch("/api/message/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            messageIds: uniqueIds,
            destinationFolderId
          })
        });
        if (!res.ok) {
          if (reportErrorOnFailure) {
            reportError(await readErrorMessage(res));
          }
          return null;
        }
        const data = (await res.json()) as MoveApiResponse;
        setMessages((prev) =>
          prev
            .map((item) => {
              if (!idSet.has(item.id)) return item;
              return {
                ...item,
                folderId: data.destinationFolderId,
                mailboxPath: data.destinationMailbox ?? item.mailboxPath
              };
            })
            .filter((item) => {
              if (
                searchScope === "folder" &&
                activeFolderId &&
                idSet.has(item.id) &&
                item.folderId !== activeFolderId
              ) {
                return false;
              }
              return true;
            })
        );
        if (
          updateActiveMessage &&
          idSet.has(activeMessageId) &&
          searchScope === "folder" &&
          activeFolderId !== destinationFolderId
        ) {
          setActiveMessageId("");
        }
        if (clearSelectionOnSuccess) {
          clearSelectionState();
        }
        const destinationName = folderById.get(destinationFolderId)?.name ?? "folder";
        if (showNotice) {
          pushNotice({
            type: "success",
            title:
              uniqueIds.length === 1
                ? `Moved message to ${destinationName}.`
                : `Moved ${uniqueIds.length} messages to ${destinationName}.`,
            description: singleSubject,
            actionLabel: undoTargets.length > 0 ? "Undo" : undefined,
            onAction:
              undoTargets.length > 0
                ? () =>
                    void undoMoveOperation(
                      undoTargets,
                      activeAccountId,
                      undoTargets.length === 1 ? "Move undone." : "Moves undone."
                    )
                : undefined,
            durationMs: undoTargets.length > 0 ? 12000 : noticeSuccessTimeout
          });
        }
        if (onMoveComplete) {
          onMoveComplete(uniqueIds);
        }
        return {
          ids: uniqueIds,
          undoTargets,
          destinationFolderId: data.destinationFolderId,
          destinationName,
          singleSubject
        };
      } catch {
        if (reportErrorOnFailure) {
          reportError("Failed to move messages.");
        }
        return null;
      } finally {
        if (managePendingState) {
          setPendingMessageActions((prev) => {
            const next = new Set(prev);
            uniqueIds.forEach((id) => next.delete(id));
            return next;
          });
        }
      }
    },
    [
      activeAccountId,
      activeFolderId,
      activeMessageId,
      apiFetch,
      clearSelectionState,
      folderById,
      getMessageSubjectForNotice,
      messages,
      noticeSuccessTimeout,
      pushNotice,
      readErrorMessage,
      reportError,
      searchScope,
      selectionStore,
      setActiveMessageId,
      setMessages,
      setPendingMessageActions,
      undoMoveOperation,
      onMoveComplete
    ]
  );

  const handleMoveMessages = useCallback(
    (destinationFolderId: string, messageIds?: string[]) => {
      void moveMessagesToFolder(destinationFolderId, {
        messageIds,
        showNotice: true,
        clearSelectionOnSuccess: true,
        managePendingState: true,
        updateActiveMessage: true,
        reportErrorOnFailure: true
      });
    },
    [moveMessagesToFolder]
  );

  return {
    handleMoveMessages,
    moveMessagesToFolder
  };
}
