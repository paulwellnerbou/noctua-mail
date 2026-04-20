/**
 * Pure reducers for the thread-content LRU cache.
 *
 * The thread-content cache is a map of threadId to the enriched list of messages
 * belonging to that thread. Insertions and updates are performed through these
 * reducer-style helpers so the shape-only logic can be reasoned about in
 * isolation from the React state machinery that owns the map.
 */
import type { Message } from "@/lib/data";
import { applyFlagsToMessage } from "./messageHelpers";

export type ThreadContentMap = Record<string, Message[]>;

/**
 * Insert or replace a thread's message list while maintaining LRU eviction.
 * Returns the next map together with the next recency order.
 */
export function upsertThreadInCache(
  prev: ThreadContentMap,
  order: string[],
  threadId: string,
  items: Message[],
  limit: number
): { next: ThreadContentMap; order: string[] } {
  const next: ThreadContentMap = { ...prev, [threadId]: items };
  const nextOrder = order.filter((id) => id !== threadId);
  nextOrder.push(threadId);
  while (nextOrder.length > limit) {
    const evict = nextOrder.shift();
    if (evict) delete next[evict];
  }
  return { next, order: nextOrder };
}

/**
 * Merge a freshly-hydrated message into every thread that already holds it.
 * If the thread does not contain the message's id the message is appended so
 * newly-arrived messages become visible without a full refetch.
 *
 * Returns the previous map unchanged when no containing thread exists (callers
 * rely on reference equality to skip re-renders).
 */
export function updateThreadCacheWithMessageMap(
  prev: ThreadContentMap,
  message: Message
): ThreadContentMap {
  const threadId = message.threadId ?? message.messageId ?? message.id;
  if (!threadId) return prev;
  const cached = prev[threadId];
  if (!cached || cached.length === 0) return prev;
  let updated = false;
  let found = false;
  const nextThread = cached.map((item) => {
    if (item.id !== message.id) return item;
    found = true;
    updated = true;
    return { ...item, ...message, groupKey: item.groupKey ?? message.groupKey };
  });
  if (!found) {
    updated = true;
    nextThread.push({ ...message, groupKey: message.groupKey });
  }
  if (!updated) return prev;
  return { ...prev, [threadId]: nextThread };
}

/**
 * Remove the given message ids from every thread and drop threads that become
 * empty. Reports whether the map actually changed so callers can skip state
 * updates when nothing was removed.
 */
export function evictMessagesFromThreadCacheMap(
  prev: ThreadContentMap,
  messageIds: Iterable<string>
): { next: ThreadContentMap; changed: boolean } {
  const idSet = new Set(messageIds);
  if (idSet.size === 0) return { next: prev, changed: false };
  let changed = false;
  const next: ThreadContentMap = { ...prev };
  Object.entries(prev).forEach(([threadId, items]) => {
    const filtered = items.filter((item) => !idSet.has(item.id));
    if (filtered.length === items.length) return;
    changed = true;
    if (filtered.length === 0) {
      delete next[threadId];
    } else {
      next[threadId] = filtered;
    }
  });
  return changed ? { next, changed } : { next: prev, changed: false };
}

/**
 * Apply a new flag set to a cached message wherever it appears.
 */
export function updateThreadCacheMapWithFlags(
  prev: ThreadContentMap,
  messageId: string,
  flags: string[]
): ThreadContentMap {
  let changed = false;
  const next: ThreadContentMap = { ...prev };
  Object.entries(prev).forEach(([threadId, list]) => {
    const idx = list.findIndex((item) => item.id === messageId);
    if (idx < 0) return;
    const updated = applyFlagsToMessage(list[idx], flags);
    const nextList = [...list];
    nextList[idx] = updated;
    next[threadId] = nextList;
    changed = true;
  });
  return changed ? next : prev;
}

/**
 * Replace a cached message's category triple wherever it appears.
 */
export function updateThreadCacheMapWithCategory(
  prev: ThreadContentMap,
  messageId: string,
  category: Message["category"],
  categoryScore: Message["categoryScore"],
  categorySignals: Message["categorySignals"]
): ThreadContentMap {
  let changed = false;
  const next: ThreadContentMap = { ...prev };
  Object.entries(prev).forEach(([threadId, list]) => {
    const idx = list.findIndex((item) => item.id === messageId);
    if (idx < 0) return;
    const current = list[idx];
    const updated = { ...current, category, categoryScore, categorySignals };
    const nextList = [...list];
    nextList[idx] = updated;
    next[threadId] = nextList;
    changed = true;
  });
  return changed ? next : prev;
}
