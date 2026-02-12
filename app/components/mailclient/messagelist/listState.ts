import { useCallback, useEffect, useMemo, useRef } from "react";
import type React from "react";
import type { Message } from "@/lib/data";
import {
  buildGroupedMessages,
  buildVisibleMessagesForSelection,
  type MessageGroupMeta,
  type ThreadNode,
  type VisibleMessageEntry
} from "./listModel";

type UseMessageListDerivedStateParams = {
  sortedMessages: Message[];
  threadRelatedMessages: Message[];
  includeThreadAcrossFoldersForList: boolean;
  isThreadExcludedFolder: (folderId?: string | null) => boolean;
  supportsThreads: boolean;
  groupMeta: MessageGroupMeta[];
  isFlaggedMessage: (message: Message) => boolean;
  computeGroupMeta: (items: Message[]) => MessageGroupMeta[];
  includeFlaggedGroup?: boolean;
  collapsedGroups: Record<string, boolean>;
  collapsedThreads: Record<string, boolean>;
  includeThreadAcrossFolders: boolean;
  searchScope: "folder" | "all";
  activeFolderId: string;
  buildThreadTree: (items: Message[]) => ThreadNode[];
  flattenThread: (
    node: ThreadNode,
    depth?: number,
    visited?: Set<string>
  ) => Array<{ message: Message; depth: number }>;
  getThreadLatestDate: (node: ThreadNode) => number;
  userEmail?: string;
  preferToDisplay: boolean;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
};

export function mergeCollapsedGroupsWithMeta(
  prev: Record<string, boolean>,
  groupMeta: MessageGroupMeta[]
) {
  const next: Record<string, boolean> = {};
  groupMeta.forEach((group) => {
    next[group.key] = prev[group.key] ?? false;
  });
  return next;
}

export function mergeCollapsedThreadsWithMessages(
  prev: Record<string, boolean>,
  messages: Message[]
) {
  const next = { ...prev };
  const threadIds = new Set(
    messages.map((message) => message.threadId ?? message.messageId ?? message.id)
  );
  threadIds.forEach((id) => {
    if (!(id in next)) next[id] = true;
  });
  return next;
}

export function useMessageListDerivedState({
  sortedMessages,
  threadRelatedMessages,
  includeThreadAcrossFoldersForList,
  isThreadExcludedFolder,
  supportsThreads,
  groupMeta,
  isFlaggedMessage,
  computeGroupMeta,
  includeFlaggedGroup = true,
  collapsedGroups,
  collapsedThreads,
  includeThreadAcrossFolders,
  searchScope,
  activeFolderId,
  buildThreadTree,
  flattenThread,
  getThreadLatestDate,
  userEmail,
  preferToDisplay,
  setCollapsedGroups
}: UseMessageListDerivedStateParams) {
  const threadScopeMessages = useMemo(() => {
    if (!includeThreadAcrossFoldersForList) {
      return sortedMessages;
    }
    const baseMessages = [...sortedMessages, ...threadRelatedMessages].filter(
      (message) => !isThreadExcludedFolder(message.folderId)
    );
    const seen = new Set<string>();
    const selected: Message[] = [];
    baseMessages.forEach((message) => {
      if (seen.has(message.id)) return;
      seen.add(message.id);
      selected.push(message);
    });
    return selected;
  }, [
    includeThreadAcrossFoldersForList,
    isThreadExcludedFolder,
    sortedMessages,
    threadRelatedMessages
  ]);

  const listScopeMessages = useMemo(
    () => (supportsThreads ? threadScopeMessages : sortedMessages),
    [sortedMessages, supportsThreads, threadScopeMessages]
  );

  const groupedMessages = useMemo(
    () =>
      buildGroupedMessages({
        listScopeMessages,
        supportsThreads,
        groupMeta,
        buildThreadTree,
        flattenThread,
        isFlaggedMessage,
        computeGroupMeta,
        includeFlaggedGroup
      }),
    [
      buildThreadTree,
      computeGroupMeta,
      flattenThread,
      includeFlaggedGroup,
      groupMeta,
      isFlaggedMessage,
      listScopeMessages,
      supportsThreads
    ]
  );

  const visibleMessages = useMemo(
    () =>
      buildVisibleMessagesForSelection({
        groupedMessages,
        collapsedGroups,
        collapsedThreads,
        supportsThreads,
        includeThreadAcrossFolders,
        searchScope,
        activeFolderId,
        buildThreadTree,
        flattenThread,
        getThreadLatestDate,
        userEmail,
        preferToDisplay
      }),
    [
      activeFolderId,
      buildThreadTree,
      collapsedGroups,
      collapsedThreads,
      flattenThread,
      getThreadLatestDate,
      groupedMessages,
      includeThreadAcrossFolders,
      preferToDisplay,
      searchScope,
      supportsThreads,
      userEmail
    ]
  );

  const visibleIndexById = useMemo(() => {
    const map = new Map<string, number>();
    visibleMessages.forEach((item, index) => map.set(item.message.id, index));
    return map;
  }, [visibleMessages]);
  const visibleIndexByIdRef = useRef(visibleIndexById);
  const visibleMessagesRef = useRef<VisibleMessageEntry[]>(visibleMessages);

  useEffect(() => {
    visibleIndexByIdRef.current = visibleIndexById;
    visibleMessagesRef.current = visibleMessages;
  }, [visibleIndexById, visibleMessages]);

  const toggleAllGroups = useCallback(() => {
    const anyOpen = groupedMessages.some((group) => !collapsedGroups[group.key]);
    const next: Record<string, boolean> = {};
    groupedMessages.forEach((group) => {
      next[group.key] = anyOpen;
    });
    setCollapsedGroups(next);
  }, [collapsedGroups, groupedMessages, setCollapsedGroups]);

  return {
    threadScopeMessages,
    groupedMessages,
    visibleMessages,
    visibleIndexByIdRef,
    visibleMessagesRef,
    toggleAllGroups
  };
}
