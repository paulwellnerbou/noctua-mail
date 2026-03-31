import type { Message } from "@/lib/data";
import type { VisibleMessageEntry } from "./listModel";
import type { SelectionStore } from "./selectionStore";
import { getCollapsedThreadRepresentativeMessage } from "./threadRepresentativeMessage";

type ThreadFlatEntry = { message: Message; depth: number };

export function selectRangeToMessage(params: {
  messageId: string;
  lastSelectedId: string | null;
  indexMap: Map<string, number>;
  visibleMessages: VisibleMessageEntry[];
  collapsedThreads: Record<string, boolean>;
  threadScopeMessages: Message[];
  selectionStore: SelectionStore;
  setLastSelectedId: (id: string) => void;
}) {
  const {
    messageId,
    lastSelectedId,
    indexMap,
    visibleMessages,
    collapsedThreads,
    threadScopeMessages,
    selectionStore,
    setLastSelectedId
  } = params;
  if (!lastSelectedId || !indexMap.has(lastSelectedId) || !indexMap.has(messageId)) {
    selectionStore.setSelection(new Set([messageId]));
    setLastSelectedId(messageId);
    return;
  }
  const start = indexMap.get(lastSelectedId)!;
  const end = indexMap.get(messageId)!;
  const [lo, hi] = start < end ? [start, end] : [end, start];
  const visibleIds = visibleMessages.slice(lo, hi + 1).map((item) => item.message.id);
  const expandedIds = expandVisibleSelectionIds({
    selectedIds: visibleIds,
    visibleMessages,
    collapsedThreads,
    threadScopeMessages
  });
  selectionStore.setSelection(new Set(expandedIds));
  setLastSelectedId(messageId);
}

export function selectAllVisibleMessages(params: {
  visibleMessages: VisibleMessageEntry[];
  collapsedThreads: Record<string, boolean>;
  threadScopeMessages: Message[];
  selectionStore: SelectionStore;
  setLastSelectedId: (id: string | null) => void;
}) {
  const {
    visibleMessages,
    collapsedThreads,
    threadScopeMessages,
    selectionStore,
    setLastSelectedId
  } = params;
  const visibleIds = visibleMessages.map((item) => item.message.id);
  if (visibleIds.length === 0) {
    setLastSelectedId(null);
    return;
  }
  const expandedIds = expandVisibleSelectionIds({
    selectedIds: visibleIds,
    visibleMessages,
    collapsedThreads,
    threadScopeMessages
  });
  selectionStore.setSelection(new Set(expandedIds));
  setLastSelectedId(visibleIds[visibleIds.length - 1] ?? null);
}

export function clearListSelection(params: {
  selectionStore: SelectionStore;
  setLastSelectedId: (id: string | null) => void;
}) {
  const { selectionStore, setLastSelectedId } = params;
  selectionStore.clearSelection();
  setLastSelectedId(null);
}

export function toggleListMessageSelection(params: {
  messageId: string;
  replace?: boolean;
  setActive?: boolean;
  selectionStore: SelectionStore;
  setLastSelectedId: (id: string) => void;
}) {
  const {
    messageId,
    replace = false,
    setActive = true,
    selectionStore,
    setLastSelectedId
  } = params;
  selectionStore.toggle(messageId, replace, setActive);
  setLastSelectedId(messageId);
}

export function getCollapsedRootThreadMessageIds(params: {
  selectedIds: string[];
  visibleMessages: VisibleMessageEntry[];
  collapsedThreads: Record<string, boolean>;
  threadScopeMessages: Message[];
}) {
  const { selectedIds, visibleMessages, collapsedThreads, threadScopeMessages } = params;
  if (selectedIds.length === 0) return null;

  const visibleThreadIdByMessageId = new Map<string, string>();
  const collapsedVisibleThreadIds = new Set<string>();
  visibleMessages.forEach((item) => {
    visibleThreadIdByMessageId.set(item.message.id, item.threadId);
    if (item.depth !== 0) return;
    const isThreadCollapsed = collapsedThreads[item.threadId] ?? true;
    if (!isThreadCollapsed) return;
    collapsedVisibleThreadIds.add(item.threadId);
  });

  const threadIdByMessageId = new Map<string, string>();
  const messageIdsByThreadId = new Map<string, string[]>();
  threadScopeMessages.forEach((message) => {
    const threadId = message.threadId ?? message.messageId ?? message.id;
    threadIdByMessageId.set(message.id, threadId);
    const list = messageIdsByThreadId.get(threadId);
    if (list) {
      list.push(message.id);
    } else {
      messageIdsByThreadId.set(threadId, [message.id]);
    }
  });

  const expandedIds = new Set(selectedIds);
  let hasCollapsedRootSelection = false;

  selectedIds.forEach((selectedId) => {
    const threadId =
      visibleThreadIdByMessageId.get(selectedId) ?? threadIdByMessageId.get(selectedId);
    if (!threadId) return;
    if (!collapsedVisibleThreadIds.has(threadId)) return;
    const threadMessageIds = messageIdsByThreadId.get(threadId) ?? [];
    if (threadMessageIds.length <= 1) return;
    hasCollapsedRootSelection = true;
    threadMessageIds.forEach((id) => expandedIds.add(id));
  });

  if (!hasCollapsedRootSelection) return null;
  return Array.from(expandedIds);
}

function expandVisibleSelectionIds(params: {
  selectedIds: string[];
  visibleMessages: VisibleMessageEntry[];
  collapsedThreads: Record<string, boolean>;
  threadScopeMessages: Message[];
}) {
  const { selectedIds, visibleMessages, collapsedThreads, threadScopeMessages } = params;
  return (
    getCollapsedRootThreadMessageIds({
      selectedIds,
      visibleMessages,
      collapsedThreads,
      threadScopeMessages
    }) ?? selectedIds
  );
}

export function resolveCollapsedThreadSelectionTarget(params: {
  flat: ThreadFlatEntry[];
  target: Message;
  isFlaggedMessage: (message: Message) => boolean;
  options?: { isFlaggedGroup?: boolean };
}) {
  return getCollapsedThreadRepresentativeMessage(params);
}
