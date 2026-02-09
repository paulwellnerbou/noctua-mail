import type React from "react";
import type { Message } from "@/lib/data";
import type { ListRowItem, VisibleMessageEntry } from "./listModel";
import { getThreadSelectionState } from "./listModel";
import type { SelectionStore } from "./selectionStore";
import {
  getDisplaySeenForThreadRow,
  getThreadMessagesForThreadRow,
  isCollapsedThreadRootRow
} from "./threadGroupUtils";

type ThreadFlatEntry = { message: Message; depth: number };

type SelectCollapsedThread = (
  flat: ThreadFlatEntry[],
  target: Message,
  options?: { isFlaggedGroup?: boolean }
) => void;

export const hasSelectionModifier = (event: {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}) => event.shiftKey || event.metaKey || event.ctrlKey;

export function handleCollapsedThreadRootClick<E extends {
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}>(params: {
  event: E;
  supportsThreads: boolean;
  isCollapsedThreadRoot: boolean;
  fullFlat: ThreadFlatEntry[];
  message: Message;
  isFlaggedGroup: boolean;
  selectCollapsedThread: SelectCollapsedThread;
  onDefault: () => void;
}) {
  const {
    event,
    supportsThreads,
    isCollapsedThreadRoot,
    fullFlat,
    message,
    isFlaggedGroup,
    selectCollapsedThread,
    onDefault
  } = params;
  if (!hasSelectionModifier(event) && supportsThreads && isCollapsedThreadRoot) {
    selectCollapsedThread(fullFlat, message, {
      isFlaggedGroup
    });
    return true;
  }
  onDefault();
  return false;
}

export function handleMessageRowKeyDown(params: {
  event: React.KeyboardEvent;
  messageId: string;
  onSelect: () => void;
  selectRangeTo: (messageId: string) => void;
  toggleMessageSelection: (messageId: string, replace?: boolean, setActive?: boolean) => void;
}) {
  const { event, messageId, onSelect, selectRangeTo, toggleMessageSelection } = params;
  if (event.key === " ") {
    event.preventDefault();
    if (event.shiftKey) {
      selectRangeTo(messageId);
    } else {
      toggleMessageSelection(messageId);
    }
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    onSelect();
  }
}

export function getThreadCheckboxState(params: {
  isThreadSelectionRoot: boolean;
  isThreadSelectionAllSelected: boolean;
  isThreadSelectionPartiallySelected: boolean;
  isSelected: boolean;
}): boolean | "indeterminate" {
  const {
    isThreadSelectionRoot,
    isThreadSelectionAllSelected,
    isThreadSelectionPartiallySelected,
    isSelected
  } = params;
  if (!isThreadSelectionRoot) return isSelected;
  if (isThreadSelectionAllSelected) return true;
  if (isThreadSelectionPartiallySelected) return "indeterminate";
  return false;
}

export function toggleThreadRootSelection(params: {
  selectedMessageIds: Set<string>;
  threadSelectionIds: string[];
  isThreadSelectionAllSelected: boolean;
  selectionStore: SelectionStore;
}) {
  const {
    selectedMessageIds,
    threadSelectionIds,
    isThreadSelectionAllSelected,
    selectionStore
  } = params;
  const next = new Set(selectedMessageIds);
  if (isThreadSelectionAllSelected) {
    threadSelectionIds.forEach((id) => next.delete(id));
  } else {
    threadSelectionIds.forEach((id) => next.add(id));
  }
  selectionStore.setSelection(next);
}

export function handleRowCheckboxChange(params: {
  shiftKey: boolean;
  messageId: string;
  isThreadSelectionRoot: boolean;
  selectedMessageIds: Set<string>;
  threadSelectionIds: string[];
  isThreadSelectionAllSelected: boolean;
  selectionStore: SelectionStore;
  selectRangeTo: (messageId: string) => void;
  toggleMessageSelection: (messageId: string, replace?: boolean, setActive?: boolean) => void;
  setLastSelectedIdRef?: (id: string | null) => void;
}) {
  const {
    shiftKey,
    messageId,
    isThreadSelectionRoot,
    selectedMessageIds,
    threadSelectionIds,
    isThreadSelectionAllSelected,
    selectionStore,
    selectRangeTo,
    toggleMessageSelection,
    setLastSelectedIdRef
  } = params;
  if (isThreadSelectionRoot) {
    toggleThreadRootSelection({
      selectedMessageIds,
      threadSelectionIds,
      isThreadSelectionAllSelected,
      selectionStore
    });
    setLastSelectedIdRef?.(messageId);
    return;
  }
  if (shiftKey) {
    selectRangeTo(messageId);
  } else {
    toggleMessageSelection(messageId, false, false);
  }
}

export function getDragThreadMessageIds(params: {
  isCollapsedThreadRoot: boolean;
  fullFlat: ThreadFlatEntry[];
}) {
  const { isCollapsedThreadRoot, fullFlat } = params;
  if (!isCollapsedThreadRoot) return undefined;
  return fullFlat.map((entry) => entry.message.id);
}

export function getCollapsedRootThreadMessageIds(params: {
  selectedIds: string[];
  visibleMessages: VisibleMessageEntry[];
  collapsedThreads: Record<string, boolean>;
  threadScopeMessages: Message[];
}) {
  const { selectedIds, visibleMessages, collapsedThreads, threadScopeMessages } = params;
  if (selectedIds.length === 0) return null;

  const selectedSet = new Set(selectedIds);
  const expandedIds = new Set(selectedIds);
  let hasCollapsedRootSelection = false;

  visibleMessages.forEach((item) => {
    if (!selectedSet.has(item.message.id) || item.depth !== 0) return;
    const isThreadCollapsed = collapsedThreads[item.threadId] ?? true;
    if (!isThreadCollapsed) return;
    const threadMessageIds = threadScopeMessages
      .filter((message) => {
        const key = message.threadId ?? message.messageId ?? message.id;
        return key === item.threadId;
      })
      .map((message) => message.id);
    if (threadMessageIds.length <= 1) return;
    hasCollapsedRootSelection = true;
    threadMessageIds.forEach((id) => expandedIds.add(id));
  });

  if (!hasCollapsedRootSelection) return null;
  return Array.from(expandedIds);
}

export function getThreadRowSelectionMeta(params: {
  item: ListRowItem;
  supportsThreads: boolean;
  selectedMessageIds: Set<string>;
  activeMessageId: string | null;
  includeSubThreadRoots?: boolean;
}) {
  const {
    item,
    supportsThreads,
    selectedMessageIds,
    activeMessageId,
    includeSubThreadRoots = true
  } = params;
  const isSelected = selectedMessageIds.has(item.message.id);
  const threadSelection = getThreadSelectionState({
    item,
    supportsThreads,
    selectedMessageIds,
    activeMessageId,
    includeSubThreadRoots
  });
  const rowSelected =
    isSelected ||
    (threadSelection.isThreadSelectionRoot && threadSelection.isThreadSelectionPartiallySelected);
  const checkboxState = getThreadCheckboxState({
    isThreadSelectionRoot: threadSelection.isThreadSelectionRoot,
    isThreadSelectionAllSelected: threadSelection.isThreadSelectionAllSelected,
    isThreadSelectionPartiallySelected: threadSelection.isThreadSelectionPartiallySelected,
    isSelected
  });
  const showThreadSelectionActive =
    threadSelection.isThreadSelectionRoot &&
    threadSelection.isThreadSelectionActive &&
    item.message.id !== activeMessageId;

  return {
    ...threadSelection,
    isSelected,
    rowSelected,
    checkboxState,
    showThreadSelectionActive
  };
}

export function getThreadRowDisplayMeta(params: { item: ListRowItem }) {
  const { item } = params;
  const message = item.message;
  const isCollapsedThreadRoot = isCollapsedThreadRootRow({
    isCollapsed: item.isCollapsed,
    threadSize: item.threadSize,
    depth: item.depth,
    threadIndex: item.threadIndex
  });
  const displaySeen = getDisplaySeenForThreadRow({
    messageSeen: Boolean(message.seen),
    messageId: message.id,
    isCollapsed: item.isCollapsed,
    threadSize: item.threadSize,
    depth: item.depth,
    threadIndex: item.threadIndex,
    isNestedCollapsed: item.isNestedCollapsed,
    fullFlat: item.fullFlat
  });
  const threadMessages = getThreadMessagesForThreadRow({
    message,
    messageId: message.id,
    isCollapsed: item.isCollapsed,
    threadSize: item.threadSize,
    depth: item.depth,
    threadIndex: item.threadIndex,
    isNestedCollapsed: item.isNestedCollapsed,
    fullFlat: item.fullFlat
  });

  return {
    isCollapsedThreadRoot,
    displaySeen,
    threadMessages
  };
}

export function isRowAnimatedFromNestedToggle(params: {
  animationClock: number;
  lastNestedToggle: { key: string; open: boolean; at: number } | null;
  messageId: string;
  itemDepth: number;
  fullFlat: Array<{ message: Message; depth: number }>;
}) {
  const {
    animationClock,
    lastNestedToggle,
    messageId,
    itemDepth,
    fullFlat
  } = params;
  if (!animationClock || !lastNestedToggle?.open || itemDepth === 0) return false;
  if (animationClock - lastNestedToggle.at >= 220) return false;

  const expandedId = lastNestedToggle.key;
  const flatIndex = fullFlat.findIndex((entry) => entry.message.id === messageId);
  const expandedIndex = fullFlat.findIndex((entry) => entry.message.id === expandedId);
  if (expandedIndex === -1 || flatIndex <= expandedIndex) return false;

  const expandedDepth = fullFlat[expandedIndex].depth;
  if (itemDepth <= expandedDepth) return false;
  for (let i = expandedIndex + 1; i < flatIndex; i++) {
    if (fullFlat[i].depth <= expandedDepth) {
      return false;
    }
  }
  return true;
}

export function isRowAnimatedFromGroupToggle(params: {
  animationClock: number;
  lastGroupToggle: { key: string; open: boolean; at: number } | null;
  groupKey: string;
}) {
  const { animationClock, lastGroupToggle, groupKey } = params;
  return (
    animationClock > 0 &&
    Boolean(lastGroupToggle?.open) &&
    lastGroupToggle?.key === groupKey &&
    animationClock - (lastGroupToggle?.at ?? 0) < 220
  );
}
