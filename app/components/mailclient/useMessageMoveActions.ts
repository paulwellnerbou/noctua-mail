"use client";

import type React from "react";
import { useCallback } from "react";
import { buildAccountMessagesActionPath } from "@/lib/accountApiPaths";
import type { Folder, Message } from "@/lib/data";
import type { SelectionStore } from "./messagelist/selectionStore";
import type { ThreadMoveRequest } from "./utils/messageMove";
import {
  applyFolderTransferCounts,
  getMessageSubjectForNotice,
  pruneDetachedCrossFolderThreadMessages,
  remapMessageReferenceIds
} from "./utils/messageMutation";
import { decrementGroupMetaForMessages } from "./utils/messageHelpers";
import type { MessageGroupMeta } from "./messagelist/listModel";

export type UndoMoveTarget = {
  messageId: string;
  restoreFolderId: string;
  /**
   * RFC 5322 `Message-ID` header for the message at the time the undo target
   * was captured. Carried alongside the internal row id so notification dedup
   * can seed by header even after the message has been removed from local
   * state by the move that we're undoing.
   */
  headerMessageId?: string;
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
  undoTargets?: UndoMoveTarget[];
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
  threadMove?: ThreadMoveRequest;
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
  includeThreadAcrossFoldersForList: boolean;
  messages: Message[];
  selectionStore: SelectionStore;
  folderById: Map<string, { name: string }>;
  lastSelectedIdRef: React.MutableRefObject<string | null>;
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setGroupMeta: React.Dispatch<React.SetStateAction<MessageGroupMeta[]>>;
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

export function shouldKeepMovedMessageVisible(params: {
  message: Message;
  searchScope: "folder" | "all";
  activeFolderId: string;
  shouldKeepMessageInResults?: (message: Message) => boolean;
}) {
  const {
    message,
    searchScope,
    activeFolderId,
    shouldKeepMessageInResults
  } = params;
  if (shouldKeepMessageInResults) {
    return shouldKeepMessageInResults(message);
  }
  return !(
    searchScope === "folder" &&
    activeFolderId &&
    message.folderId !== activeFolderId
  );
}

export function useMessageMoveActions({
  activeAccountId,
  activeMessageId,
  activeFolderId,
  searchScope,
  includeThreadAcrossFoldersForList,
  messages,
  selectionStore,
  folderById,
  lastSelectedIdRef,
  setFolders,
  setMessages,
  setGroupMeta,
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
      const uniqueIds = Array.from(new Set(ids));
      const threadMove = options?.threadMove;
      if (uniqueIds.length === 0 && !threadMove) return null;
      const idSet = new Set(uniqueIds);
      const sourceTargets = messages
        .filter((item) => item.accountId === activeAccountId && idSet.has(item.id))
      const localUndoTargets: UndoMoveTarget[] = sourceTargets.map((item) => ({
        messageId: item.id,
        restoreFolderId: item.folderId,
        headerMessageId: item.messageId
      }));
      const headerMessageIdByRowId = new Map<string, string>();
      sourceTargets.forEach((item) => {
        if (item.messageId) headerMessageIdByRowId.set(item.id, item.messageId);
      });
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
        const res = await apiFetch(buildAccountMessagesActionPath(activeAccountId, "move"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageIds: uniqueIds,
            destinationFolderId,
            threadMove
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
        const movedCount = movedPreviousIds.size;
        if (movedCount === 0) {
          return null;
        }
        const resolveMovedId = (id: string) => idRemap.get(id) ?? id;
        const fallbackUndoTargets = localUndoTargets
          .filter((target) => movedPreviousIds.has(target.messageId))
          .map((target) => ({
            ...target,
            messageId: resolveMovedId(target.messageId)
          }));
        const responseUndoTargets = Array.isArray(data.undoTargets)
          ? data.undoTargets
              .filter(
                (target): target is UndoMoveTarget =>
                  Boolean(target?.messageId) && Boolean(target?.restoreFolderId)
              )
              .map((target) => {
                // Server returns the internal row id (the message's `previousId`
                // before the move). Use that to look up the header we captured
                // from local state before the move stripped these messages out.
                const headerMessageId =
                  target.headerMessageId ?? headerMessageIdByRowId.get(target.messageId);
                return {
                  ...target,
                  messageId: resolveMovedId(target.messageId),
                  ...(headerMessageId ? { headerMessageId } : {})
                };
              })
          : [];
        const mappedUndoTargets =
          responseUndoTargets.length > 0 ? responseUndoTargets : fallbackUndoTargets;
        markMessagesMutated?.();
        setFolders((prev) =>
          applyFolderTransferCounts(
            prev,
            sourceTargets.map((message) => ({
              fromFolderId: message.folderId,
              toFolderId: data.destinationFolderId,
              unread: Boolean(message.unread ?? !message.seen)
            }))
          )
        );
        // `removedFromList` is populated by the setMessages updater
        // (reads `prev`, the authoritative latest state) and consumed by
        // the setGroupMeta updater queued right after. Both updaters
        // run in order within the same React batch, so the closure is
        // reliable even when the surrounding handler is async.
        let removedFromList: Message[] = [];
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
            const keep = shouldKeepMovedMessageVisible({
              message: updated,
              searchScope,
              activeFolderId,
              shouldKeepMessageInResults
            });
            changed = true;
            if (!keep) return;
            nextById.set(updated.id, updated);
          });
          const nextMessages = changed ? Array.from(nextById.values()) : prev;
          const next = pruneDetachedCrossFolderThreadMessages(nextMessages, {
            searchScope,
            activeFolderId,
            includeThreadAcrossFoldersForList
          });
          // Moved messages get their id remapped via `resolveMovedId`, so
          // resolve each prev id to its post-move counterpart before
          // checking membership — otherwise a kept-but-renamed message
          // would be misidentified as removed.
          const nextIds = new Set(next.map((item) => item.id));
          removedFromList = prev.filter(
            (item) => !nextIds.has(resolveMovedId(item.id))
          );
          return next;
        });
        setGroupMeta((prev) =>
          removedFromList.length > 0
            ? decrementGroupMetaForMessages(prev, removedFromList)
            : prev
        );
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
            ? shouldKeepMovedMessageVisible({
                message: activeUpdated,
                searchScope,
                activeFolderId,
                shouldKeepMessageInResults
              })
            : false;
          if (!activeStillVisible) {
            setActiveMessageId("");
            setViewMessage(null);
          } else if (resolvedActiveId !== activeMessageId) {
            setActiveMessageId(resolvedActiveId);
            setViewMessage(activeUpdated);
          }
        }
        if (clearSelectionOnSuccess && movedCount > 0) {
          clearSelectionState();
        }
        const destinationName = folderById.get(destinationFolderId)?.name ?? "folder";
        const singleTarget =
          movedCount === 1
            ? messages.find((item) => movedPreviousIds.has(item.id)) ?? null
            : null;
        const singleSubject =
          movedCount === 1 ? getMessageSubjectForNotice(singleTarget) : undefined;
        if (showNotice) {
          pushNotice({
            type: "success",
            title:
              queued
                ? movedCount === 1
                  ? `Moving message to ${destinationName} in background.`
                  : `Moving ${movedCount} messages to ${destinationName} in background.`
                : movedCount === 1
                  ? `Moved message to ${destinationName}.`
                  : `Moved ${movedCount} messages to ${destinationName}.`,
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
            durationMs: noticeSuccessTimeout
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
        const resultIds = Array.from(movedPreviousIds);
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
      messages,
      noticeSuccessTimeout,
      pushNotice,
      readErrorMessage,
      reportError,
      searchScope,
      includeThreadAcrossFoldersForList,
      selectionStore,
      shouldKeepMessageInResults,
      setActiveMessageId,
      setViewMessage,
      setFolders,
      setMessages,
      setGroupMeta,
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
