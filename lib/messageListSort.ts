export const MESSAGE_LIST_SORTS = ["date", "size"] as const;

/**
 * Server-side ordering for the flat message list. "size" ranks by the byte
 * length of each message's stored raw source, largest first, so a mailbox can
 * be cleaned up from the top.
 */
export type MessageListSortBy = (typeof MESSAGE_LIST_SORTS)[number];

export const DEFAULT_MESSAGE_LIST_SORT: MessageListSortBy = "date";

export function normalizeMessageListSortBy(value?: string | null): MessageListSortBy {
  return value === "size" ? value : DEFAULT_MESSAGE_LIST_SORT;
}

/**
 * A flat ordering ranks the whole mailbox in one sequence, so grouping and
 * threading — both of which reorder rows into buckets — cannot apply.
 */
export function isFlatMessageListSort(sortBy: MessageListSortBy) {
  return sortBy === "size";
}
