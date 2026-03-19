import { useCallback, useEffect, useMemo, useRef } from "react";
import type React from "react";
import type { Message } from "@/lib/data";
import {
  buildGroupedMessages,
  buildVisibleMessagesForSelection,
  type MessageGroupMeta,
  type MessageGroup,
  type ThreadNode,
  type VisibleMessageEntry
} from "./listModel";
import { isTopicSuggestionGroupKey } from "./topicSuggestionGroup";

type UseMessageListDerivedStateParams = {
  sortedMessages: Message[];
  threadRelatedMessages: Message[];
  includeThreadAcrossFoldersForList: boolean;
  isThreadExcludedFolder: (folderId?: string | null) => boolean;
  supportsThreads: boolean;
  groupBy: string;
  groupMeta: MessageGroupMeta[];
  isFlaggedMessage: (message: Message) => boolean;
  hasDoneFlag?: (message: Message) => boolean;
  computeGroupMeta: (items: Message[]) => MessageGroupMeta[];
  includeFlaggedGroup?: boolean;
  includeDoneGroup?: boolean;
  prependedGroups?: MessageGroup[];
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
  Object.keys(prev).forEach((key) => {
    if (isTopicSuggestionGroupKey(key) && !(key in next)) {
      next[key] = prev[key];
    }
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
  groupBy,
  groupMeta,
  isFlaggedMessage,
  hasDoneFlag,
  computeGroupMeta,
  includeFlaggedGroup = true,
  includeDoneGroup = false,
  prependedGroups,
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
        groupBy,
        buildThreadTree,
        flattenThread,
        isFlaggedMessage,
        hasDoneFlag,
        computeGroupMeta,
        includeFlaggedGroup,
        includeDoneGroup
      }),
    [
      buildThreadTree,
      computeGroupMeta,
      flattenThread,
      includeFlaggedGroup,
      includeDoneGroup,
      groupBy,
      groupMeta,
      hasDoneFlag,
      isFlaggedMessage,
      listScopeMessages,
      supportsThreads
    ]
  );

  const combinedGroupedMessages = useMemo(
    () => [...(prependedGroups ?? []), ...groupedMessages],
    [groupedMessages, prependedGroups]
  );

  const visibleMessages = useMemo(
    () =>
      buildVisibleMessagesForSelection({
        groupedMessages: combinedGroupedMessages,
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
      combinedGroupedMessages,
      flattenThread,
      getThreadLatestDate,
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
    const anyOpen = combinedGroupedMessages.some(
      (group) => !(collapsedGroups[group.key] ?? (group.variant === "topic-suggestions"))
    );
    const next: Record<string, boolean> = {};
    combinedGroupedMessages.forEach((group) => {
      next[group.key] = anyOpen;
    });
    setCollapsedGroups(next);
  }, [collapsedGroups, combinedGroupedMessages, setCollapsedGroups]);

  return {
    threadScopeMessages,
    groupedMessages: combinedGroupedMessages,
    visibleMessages,
    visibleIndexByIdRef,
    visibleMessagesRef,
    toggleAllGroups
  };
}
