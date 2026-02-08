import type { Message } from "@/lib/data";
import type { VisibleMessageEntry } from "./listModel";
import type { SelectionStore } from "./selectionStore";

type ThreadFlatEntry = { message: Message; depth: number };

export function selectRangeToMessage(params: {
  messageId: string;
  lastSelectedId: string | null;
  indexMap: Map<string, number>;
  visibleMessages: VisibleMessageEntry[];
  selectionStore: SelectionStore;
  setLastSelectedId: (id: string) => void;
}) {
  const {
    messageId,
    lastSelectedId,
    indexMap,
    visibleMessages,
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
  const ids = visibleMessages.slice(lo, hi + 1).map((item) => item.message.id);
  selectionStore.setSelection(new Set(ids));
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
