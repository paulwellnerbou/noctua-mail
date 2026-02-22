"use client";

import type React from "react";
import { useCallback } from "react";
import type { Message } from "@/lib/data";
import type { SelectionStore } from "./messagelist/selectionStore";
import { getMessageSubjectForNotice, remapMessageReferenceIds } from "./utils/messageMutation";

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
  queued?: boolean;
  destinationFolderId: string;
  destinationMailbox?: string;
  movedIds?: Array<{ previousId: string; nextId: string }>;
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
  shouldKeepMessageInResults?: (message: Message) => boolean;
  setPendingMessageActions: React.Dispatch<React.SetStateAction<Set<string>>>;
  setActiveMessageId: React.Dispatch<React.SetStateAction<string>>;
  setViewMessage: (message: Message | null) => void;
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
  markMessagesMutated?: () => void;
  applyDeleteReconcileSuppression?: (input: {
    targets?: Message[];
    messageIds?: Array<string | null | undefined>;
    fallbackFolderId?: string | null;
  }) => void;
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
  shouldKeepMessageInResults,
  setPendingMessageActions,
  setActiveMessageId,
  setViewMessage,
  apiFetch,
  readErrorMessage,
  reportError,
  pushNotice,
  undoMoveOperation,
  noticeSuccessTimeout,
  onMoveComplete,
  markMessagesMutated,
  applyDeleteReconcileSuppression
}: UseMessageMoveActionsOptions) {

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
      const sourceTargets = messages
        .filter((item) => item.accountId === activeAccountId && idSet.has(item.id))
      const undoTargets: UndoMoveTarget[] = sourceTargets.map((item) => ({
        messageId: item.id,
        restoreFolderId: item.folderId
      }));
      const singleTarget =
        uniqueIds.length === 1
          ? sourceTargets[0] ?? null
          : null;
      const singleSubject =
        uniqueIds.length === 1 ? getMessageSubjectForNotice(singleTarget) : undefined;
      const managePendingState = options?.managePendingState ?? true;
      const clearSelectionOnSuccess = options?.clearSelectionOnSuccess ?? true;
      const updateActiveMessage = options?.updateActiveMessage ?? true;
      const showNotice = options?.showNotice ?? true;
      const reportErrorOnFailure = options?.reportErrorOnFailure ?? true;
      try {
        applyDeleteReconcileSuppression?.({
          targets: sourceTargets,
          messageIds: uniqueIds,
          fallbackFolderId: activeFolderId
        });
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
        const queued = Boolean(data.queued);
        const idRemap = new Map<string, string>();
        (data.movedIds ?? []).forEach((item) => {
          if (!item?.previousId || !item?.nextId) return;
          idRemap.set(item.previousId, item.nextId);
        });
        const movedPreviousIds = data.movedIds
          ? new Set(
              data.movedIds
                .map((item) => item?.previousId ?? "")
                .filter(Boolean)
            )
          : new Set(uniqueIds);
        const resolveMovedId = (id: string) => idRemap.get(id) ?? id;
        const mappedUndoTargets = undoTargets
          .filter((target) => movedPreviousIds.has(target.messageId))
          .map((target) => ({
            ...target,
            messageId: resolveMovedId(target.messageId)
          }));
        markMessagesMutated?.();
        setMessages((prev) => {
          let changed = false;
          const nextById = new Map<string, Message>();
          prev.forEach((item) => {
            if (!movedPreviousIds.has(item.id)) {
              nextById.set(item.id, item);
              return;
            }
            const resolvedId = resolveMovedId(item.id);
            const updatedBase: Message = {
              ...item,
              id: resolvedId,
              folderId: data.destinationFolderId,
              mailboxPath: data.destinationMailbox ?? item.mailboxPath,
              imapUid: queued ? undefined : item.imapUid
            };
            const updated = remapMessageReferenceIds(updatedBase, item.id, resolvedId);
            // For explicitly moved messages in folder scope, always remove from the
            // current folder view — don't let the cross-folder thread exception keep
            // them visible after they've been intentionally moved elsewhere.
            const movedToOtherFolder =
              searchScope === "folder" &&
              activeFolderId &&
              updated.folderId !== activeFolderId;
            const keep = movedToOtherFolder
              ? false
              : shouldKeepMessageInResults
                ? shouldKeepMessageInResults(updated)
                : true;
            changed = true;
            if (!keep) return;
            nextById.set(updated.id, updated);
          });
          return changed ? Array.from(nextById.values()) : prev;
        });
        if (
          updateActiveMessage &&
          movedPreviousIds.has(activeMessageId)
        ) {
          const resolvedActiveId = resolveMovedId(activeMessageId);
          const activeMessage = messages.find((item) => item.id === activeMessageId);
          const activeUpdated = activeMessage
            ? remapMessageReferenceIds(
                {
                  ...activeMessage,
                  id: resolvedActiveId,
                  folderId: data.destinationFolderId,
                  mailboxPath: data.destinationMailbox ?? activeMessage.mailboxPath,
                  imapUid: queued ? undefined : activeMessage.imapUid
                },
                activeMessage.id,
                resolvedActiveId
              )
            : null;
          const activeStillVisible = activeUpdated
            ? shouldKeepMessageInResults
              ? shouldKeepMessageInResults(activeUpdated)
              : !(
                  searchScope === "folder" &&
                  activeFolderId &&
                  activeUpdated.folderId !== activeFolderId
                )
            : false;
          if (!activeStillVisible) {
            setActiveMessageId("");
            setViewMessage(null);
          } else if (resolvedActiveId !== activeMessageId) {
            setActiveMessageId(resolvedActiveId);
            setViewMessage(activeUpdated);
          }
        }
        if (clearSelectionOnSuccess) {
          clearSelectionState();
        }
        const destinationName = folderById.get(destinationFolderId)?.name ?? "folder";
        if (showNotice) {
          pushNotice({
            type: "success",
            title:
              queued
                ? uniqueIds.length === 1
                  ? `Moving message to ${destinationName} in background.`
                  : `Moving ${uniqueIds.length} messages to ${destinationName} in background.`
                : uniqueIds.length === 1
                  ? `Moved message to ${destinationName}.`
                  : `Moved ${uniqueIds.length} messages to ${destinationName}.`,
            description: singleSubject,
            actionLabel: mappedUndoTargets.length > 0 ? "Undo" : undefined,
            onAction:
              mappedUndoTargets.length > 0
                ? () =>
                    void undoMoveOperation(
                      mappedUndoTargets,
                      activeAccountId,
                      mappedUndoTargets.length === 1 ? "Move undone." : "Moves undone."
                    )
                : undefined,
            durationMs: mappedUndoTargets.length > 0 ? 12000 : noticeSuccessTimeout
          });
        }
        if (onMoveComplete) {
          onMoveComplete(
            Array.from(
              new Set([
                ...Array.from(movedPreviousIds),
                ...Array.from(movedPreviousIds).map((id) => resolveMovedId(id))
              ])
            )
          );
        }
        const resultIds = data.movedIds ? Array.from(movedPreviousIds) : uniqueIds;
        return {
          ids: resultIds,
          undoTargets: mappedUndoTargets,
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
      remapMessageReferenceIds,
      readErrorMessage,
      reportError,
      searchScope,
      selectionStore,
      shouldKeepMessageInResults,
      setActiveMessageId,
      setViewMessage,
      setMessages,
      setPendingMessageActions,
      undoMoveOperation,
      onMoveComplete,
      markMessagesMutated,
      applyDeleteReconcileSuppression
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
