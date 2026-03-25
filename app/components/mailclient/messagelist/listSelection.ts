import type { Message } from "@/lib/data";
import type { VisibleMessageEntry } from "./listModel";
import type { SelectionStore } from "./selectionStore";

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
  const expandedIds =
    getCollapsedRootThreadMessageIds({
      selectedIds: visibleIds,
      visibleMessages,
      collapsedThreads,
      threadScopeMessages
    }) ?? visibleIds;
  selectionStore.setSelection(new Set(expandedIds));
  setLastSelectedId(messageId);
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

function getLatestThreadMessage(flat: ThreadFlatEntry[]) {
  if (!flat.length) return null;
  return flat.reduce(
    (acc, item) => (item.message.dateValue > acc.dateValue ? item.message : acc),
    flat[0].message
  );
}

function getLatestFlaggedThreadMessage(
  flat: ThreadFlatEntry[],
  isFlaggedMessage: (message: Message) => boolean
) {
  const flagged = flat.filter((item) => isFlaggedMessage(item.message));
  return getLatestThreadMessage(flagged);
}

export function resolveCollapsedThreadSelectionTarget(params: {
  flat: ThreadFlatEntry[];
  target: Message;
  isFlaggedMessage: (message: Message) => boolean;
  options?: { isFlaggedGroup?: boolean };
}) {
  const { flat, target, isFlaggedMessage, options } = params;
  const latest = getLatestThreadMessage(flat);
  const latestFlagged = options?.isFlaggedGroup
    ? getLatestFlaggedThreadMessage(flat, isFlaggedMessage)
    : null;
  const hasTarget = flat.some((item) => item.message.id === target.id);
  return latestFlagged ?? latest ?? (hasTarget ? target : (flat[0]?.message ?? target));
}
