import type { Message } from "@/lib/data";
import { INVITE_DECK_GROUP_BY, sortGroupsForGroupBy } from "@/lib/messageGrouping";
import {
  buildFlatEntries,
  buildThreadGroupEntries,
  buildVisibleThreadRows,
  getCollapsedThreadFromDisplay,
  getMessageFromDisplay,
  getThreadSubtreeMessageIds,
  hasThreadSubtreeChildren
} from "./threadGroupUtils";
import type { ThreadNode } from "./threadTree";
export type { ThreadNode } from "./threadTree";

export type MessageGroup = {
  key: string;
  label?: string;
  items: Message[];
  count?: number;
};

export type MessageGroupMeta = {
  key: string;
  label: string;
  count: number;
};

export type ListGroupItem = {
  type: "group";
  key: string;
  group: MessageGroup;
};

export type ListRowItem = {
  type: "row";
  key: string;
  groupKey: string;
  isFirstInGroup: boolean;
  message: Message;
  depth: number;
  threadGroupId: string;
  threadSize: number;
  isCollapsed: boolean;
  isFlaggedGroup: boolean;
  threadIndex: number;
  fullFlat: Array<{ message: Message; depth: number }>;
  folderIds: string[];
  fromText: string;
  fromTooltip: string;
  showRecipientIcon: boolean;
  isLastInDepth: boolean;
  hasChildren: boolean;
  isNestedCollapsed: boolean;
  ancestorStopsHere: boolean[];
};

export type ListItem = ListGroupItem | ListRowItem;

export type VisibleMessageEntry = {
  message: Message;
  depth: number;
  threadId: string;
};

export type ThreadSelectionState = {
  isThreadRoot: boolean;
  isSubThreadRoot: boolean;
  isThreadSelectionRoot: boolean;
  threadSelectionIds: string[];
  selectedInThreadSelectionCount: number;
  isThreadSelectionAllSelected: boolean;
  isThreadSelectionPartiallySelected: boolean;
  isThreadSelectionActive: boolean;
};

type SharedListParams = {
  groupedMessages: MessageGroup[];
  collapsedGroups: Record<string, boolean>;
  collapsedThreads: Record<string, boolean>;
  supportsThreads: boolean;
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
};

export type BuildMessageListItemsParams = SharedListParams & {
  mode: "flat" | "nested";
  collapsedNestedMessages?: Record<string, boolean>;
};

export function buildGroupedMessages(params: {
  listScopeMessages: Message[];
  supportsThreads: boolean;
  groupMeta: MessageGroupMeta[];
  groupBy: string;
  buildThreadTree: (items: Message[]) => ThreadNode[];
  flattenThread: (
    node: ThreadNode,
    depth?: number,
    visited?: Set<string>
  ) => Array<{ message: Message; depth: number }>;
  isFlaggedMessage: (message: Message) => boolean;
  hasDoneFlag?: (message: Message) => boolean;
  computeGroupMeta: (items: Message[]) => MessageGroupMeta[];
  includeFlaggedGroup?: boolean;
  includeDoneGroup?: boolean;
}): MessageGroup[] {
  const {
    listScopeMessages,
    supportsThreads,
    groupMeta,
    groupBy,
    buildThreadTree,
    flattenThread,
    isFlaggedMessage,
    hasDoneFlag,
    computeGroupMeta,
    includeFlaggedGroup = true,
    includeDoneGroup = false
  } = params;
  const base = [...listScopeMessages].sort((a, b) => b.dateValue - a.dateValue);
  const groups = new Map<string, Message[]>();
  const threadGroupKey = new Map<string, string>();
  const isDoneMessage = (message: Message) => includeDoneGroup && hasDoneFlag?.(message);

  if (supportsThreads) {
    buildThreadTree(base).forEach((root) => {
      const flat = flattenThread(root, 0);
      if (!flat.length) return;
      const hasFlagged = includeFlaggedGroup && flat.some(({ message }) => isFlaggedMessage(message));
      if (hasFlagged) {
        flat.forEach(({ message }) => {
          threadGroupKey.set(message.id, "Flagged");
        });
        return;
      }
      // Check for Done messages (only if all are done, thread goes to Done group)
      const allDone = includeDoneGroup && flat.every(({ message }) => isDoneMessage(message));
      if (allDone) {
        flat.forEach(({ message }) => {
          threadGroupKey.set(message.id, "Done");
        });
        return;
      }
      const latest = flat.reduce((acc, item) =>
        item.message.dateValue > acc.message.dateValue ? item : acc
      );
      const groupKey = latest.message.groupKey ?? "Other";
      flat.forEach(({ message }) => {
        threadGroupKey.set(message.id, groupKey);
      });
    });
  }

  base.forEach((message) => {
    let key: string;
    if (supportsThreads) {
      key = threadGroupKey.get(message.id) ?? message.groupKey ?? "Other";
    } else if (includeFlaggedGroup && isFlaggedMessage(message)) {
      key = "Flagged";
    } else if (isDoneMessage(message)) {
      key = "Done";
    } else {
      key = message.groupKey ?? "Other";
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(message);
  });
  const meta = groupMeta.length ? groupMeta : computeGroupMeta(base);
  const normalizedMeta = includeFlaggedGroup ? meta : meta.filter((group) => group.key !== "Flagged");
  // Keep the Flagged header count aligned with non-threaded grouping:
  // count flagged messages only, not every message inside flagged threads.
  const flaggedCount = base.filter((message) => isFlaggedMessage(message)).length;
  const doneCount = includeDoneGroup ? base.filter((message) => isDoneMessage(message)).length : 0;

  const baseMeta = normalizedMeta.filter((group) => group.key !== "Flagged" && group.key !== "Done");
  const metaKeys = new Set(baseMeta.map((group) => group.key));
  const missingMeta = Array.from(groups.entries())
    .filter(([key]) => !metaKeys.has(key) && key !== "Flagged" && key !== "Done")
    .map(([key, items]) => ({
      key,
      label: key,
      count: items.length
    }));

  const sortableMeta = [...baseMeta, ...missingMeta];
  const orderedMeta = sortGroupMetaForGroupBy(sortableMeta, groupBy);
  const mergedMeta: MessageGroupMeta[] = [];
  if (includeFlaggedGroup && flaggedCount > 0) {
    mergedMeta.push({ key: "Flagged", label: "Flagged", count: flaggedCount });
  }
  mergedMeta.push(...orderedMeta);
  // Add Done group at the end if there are done messages
  if (includeDoneGroup && doneCount > 0) {
    mergedMeta.push({ key: "Done", label: "Done", count: doneCount });
  }

  return mergedMeta.map((group) => ({
    key: group.key,
    label: group.label,
    count: group.count,
    items: groups.get(group.key) ?? []
  }));
}

function sortGroupMetaForGroupBy(groups: MessageGroupMeta[], groupBy: string) {
  if (groupBy !== "date" && groupBy !== INVITE_DECK_GROUP_BY) {
    return groups;
  }
  return sortGroupsForGroupBy(groups, groupBy);
}

export function buildMessageListItems(params: BuildMessageListItemsParams): ListItem[] {
  const {
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
    preferToDisplay,
    mode,
    collapsedNestedMessages
  } = params;

  const items: ListItem[] = [];
  const nestedState = collapsedNestedMessages ?? {};

  groupedMessages.forEach((group) => {
    items.push({ type: "group", key: group.key, group });
    if (group.items.length === 0 || collapsedGroups[group.key]) return;
    let isFirstRow = true;

    if (supportsThreads) {
      const entries = buildThreadGroupEntries({
        group,
        collapsedThreads,
        includeThreadAcrossFolders,
        searchScope,
        activeFolderId,
        buildThreadTree,
        flattenThread,
        getThreadLatestDate
      });

      entries.forEach((entry) => {
        const {
          threadGroupId,
          threadSize,
          isCollapsed,
          fullFlat,
          flat,
          threadFolderIds,
          showThreadFolderBadges
        } = entry;
        const collapsedThreadFrom =
          isCollapsed && threadSize > 1
            ? getCollapsedThreadFromDisplay(fullFlat, userEmail, preferToDisplay)
            : null;

        const rows =
          mode === "nested"
            ? buildVisibleThreadRows({
                flat,
                collapsedNestedMessages: nestedState
              })
            : flat.map(({ message, depth }) => ({
                message,
                depth,
                isLastInDepth: true,
                hasChildren: false,
                isNestedCollapsed: false,
                ancestorStopsHere: []
              }));

        rows.forEach((row, index) => {
          const { message, depth, isLastInDepth, hasChildren, isNestedCollapsed, ancestorStopsHere } =
            row;
          const folderIds =
            index === 0 && isCollapsed && threadSize > 1
              ? showThreadFolderBadges
                ? threadFolderIds
                : []
              : searchScope === "all" ||
                  (includeThreadAcrossFolders && message.folderId !== activeFolderId)
                ? [message.folderId]
                : [];
          const isInExpandedThread = !isCollapsed || index > 0;
          const fromDisplay =
            index === 0 && collapsedThreadFrom
              ? collapsedThreadFrom
              : getMessageFromDisplay(
                  message.from,
                  { to: message.to, cc: message.cc, bcc: message.bcc },
                  userEmail,
                  isInExpandedThread,
                  preferToDisplay
                );

          items.push({
            type: "row",
            key: message.id,
            groupKey: group.key,
            isFirstInGroup: isFirstRow,
            message,
            depth,
            threadGroupId,
            threadSize,
            isCollapsed,
            isFlaggedGroup: group.key === "Flagged",
            threadIndex: index,
            fullFlat,
            folderIds,
            fromText: fromDisplay.text,
            fromTooltip: fromDisplay.tooltip,
            showRecipientIcon: Boolean(fromDisplay.showRecipientIcon),
            isLastInDepth,
            hasChildren,
            isNestedCollapsed,
            ancestorStopsHere
          });
          if (isFirstRow) isFirstRow = false;
        });
      });
      return;
    }

    buildFlatEntries({
      group,
      includeThreadAcrossFolders,
      searchScope,
      activeFolderId
    }).forEach(({ message, threadGroupId, folderIds }) => {
      const fromDisplay = getMessageFromDisplay(
        message.from,
        { to: message.to, cc: message.cc, bcc: message.bcc },
        userEmail,
        false,
        preferToDisplay
      );
      items.push({
        type: "row",
        key: message.id,
        groupKey: group.key,
        isFirstInGroup: isFirstRow,
        message,
        depth: 0,
        threadGroupId,
        threadSize: 1,
        isCollapsed: false,
        isFlaggedGroup: false,
        threadIndex: 0,
        fullFlat: [{ message, depth: 0 }],
        folderIds,
        fromText: fromDisplay.text,
        fromTooltip: fromDisplay.tooltip,
        showRecipientIcon: Boolean(fromDisplay.showRecipientIcon),
        isLastInDepth: true,
        hasChildren: false,
        isNestedCollapsed: false,
        ancestorStopsHere: []
      });
      if (isFirstRow) isFirstRow = false;
    });
  });

  return items;
}

export function buildVisibleMessagesForSelection(
  params: SharedListParams
): VisibleMessageEntry[] {
  const {
    groupedMessages,
    collapsedGroups,
    collapsedThreads,
    supportsThreads,
    includeThreadAcrossFolders,
    searchScope,
    activeFolderId,
    buildThreadTree,
    flattenThread,
    getThreadLatestDate
  } = params;

  const list: VisibleMessageEntry[] = [];
  groupedMessages.forEach((group) => {
    if (group.items.length === 0 || collapsedGroups[group.key]) return;
    if (supportsThreads) {
      const entries = buildThreadGroupEntries({
        group,
        collapsedThreads,
        includeThreadAcrossFolders,
        searchScope,
        activeFolderId,
        buildThreadTree,
        flattenThread,
        getThreadLatestDate
      });
      entries.forEach(({ threadGroupId, flat }) => {
        flat.forEach((item) => {
          list.push({
            message: item.message,
            depth: item.depth,
            threadId: threadGroupId
          });
        });
      });
      return;
    }

    buildFlatEntries({
      group,
      includeThreadAcrossFolders,
      searchScope,
      activeFolderId
    }).forEach(({ message, threadGroupId }) =>
      list.push({
        message,
        depth: 0,
        threadId: threadGroupId
      })
    );
  });

  return list;
}

export function getThreadSelectionState(params: {
  item: ListRowItem;
  supportsThreads: boolean;
  selectedMessageIds: Set<string>;
  activeMessageId: string | null;
  includeSubThreadRoots?: boolean;
}): ThreadSelectionState {
  const {
    item,
    supportsThreads,
    selectedMessageIds,
    activeMessageId,
    includeSubThreadRoots = true
  } = params;
  const isThreadRoot = item.depth === 0 && item.threadIndex === 0 && item.threadSize > 1;
  const isSubThreadRoot =
    includeSubThreadRoots &&
    item.depth > 0 &&
    hasThreadSubtreeChildren(item.fullFlat, item.message.id);
  const isThreadSelectionRoot = supportsThreads && (isThreadRoot || isSubThreadRoot);
  const threadSelectionIds = isSubThreadRoot
    ? getThreadSubtreeMessageIds(item.fullFlat, item.message.id)
    : isThreadRoot
      ? item.fullFlat.map((entry) => entry.message.id)
      : [item.message.id];
  const selectedInThreadSelectionCount = threadSelectionIds.filter((id) =>
    selectedMessageIds.has(id)
  ).length;
  const isThreadSelectionAllSelected =
    threadSelectionIds.length > 0 &&
    selectedInThreadSelectionCount === threadSelectionIds.length;
  const isThreadSelectionPartiallySelected =
    selectedInThreadSelectionCount > 0 && !isThreadSelectionAllSelected;
  const isThreadSelectionActive =
    Boolean(activeMessageId) && activeMessageId !== null && threadSelectionIds.includes(activeMessageId);

  return {
    isThreadRoot,
    isSubThreadRoot,
    isThreadSelectionRoot,
    threadSelectionIds,
    selectedInThreadSelectionCount,
    isThreadSelectionAllSelected,
    isThreadSelectionPartiallySelected,
    isThreadSelectionActive
  };
}
