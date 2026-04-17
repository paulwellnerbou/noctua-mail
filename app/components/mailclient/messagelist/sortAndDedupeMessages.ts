// Pure helpers for the message-list derivation pipeline.
//
// Extracted from `MailClient.tsx`'s `accountMessages` / `sortedMessages`
// `useMemo` blocks ahead of the P1-12 Phase 4 orchestrator split so the
// logic has its own tests before moving file locations. See
// `CLEANUP/pass3-architecture.md` §3.2 for context.

import type { Message } from "@/lib/data";
import type { SortKey } from "./messageListViewTypes";

export type SortDirection = "asc" | "desc";

export type MessageDedupeDuplicate = {
  /** The id as it appeared in the input. */
  originalId: string;
  /** The synthetic id assigned to the duplicate in `deduped` output. */
  reassignedId: string;
};

export type MessageDedupeResult = {
  /**
   * Filtered + dedupe-patched messages. Duplicates get a synthetic id
   * (`<originalId>-<indexInFiltered>`) to keep React list reconciliation
   * stable during mutation/sync races; the original message shape is
   * preserved otherwise.
   */
  deduped: Message[];
  /**
   * One entry per duplicate detected after filtering. Callers may log
   * these as a warning; `dedupeAccountMessages` itself does not log.
   */
  duplicates: MessageDedupeDuplicate[];
};

/**
 * Filter `messages` to the given `accountId` and dedupe by `id`. The
 * first occurrence of each id keeps its original id; later occurrences
 * are reassigned to `<id>-<indexInFiltered>`.
 *
 * Pure — input array is not mutated, no logging side-effects.
 */
export function dedupeAccountMessages(
  messages: Message[],
  accountId: string
): MessageDedupeResult {
  const filtered = messages.filter((message) => message.accountId === accountId);
  const seen = new Set<string>();
  const duplicates: MessageDedupeDuplicate[] = [];
  const deduped: Message[] = new Array(filtered.length);
  for (let index = 0; index < filtered.length; index += 1) {
    const msg = filtered[index]!;
    let nextId = msg.id;
    if (seen.has(nextId)) {
      const reassignedId = `${msg.id}-${index}`;
      duplicates.push({ originalId: msg.id, reassignedId });
      nextId = reassignedId;
    }
    seen.add(nextId);
    deduped[index] = { ...msg, id: nextId };
  }
  return { deduped, duplicates };
}

/**
 * Sort `messages` by the given key and direction. Returns a new array;
 * input is not mutated. Uses `Array.prototype.sort`, which is stable
 * since ES2019, so messages with equal sort keys preserve their input
 * order.
 */
export function sortMessages(
  messages: Message[],
  sortKey: SortKey,
  sortDir: SortDirection
): Message[] {
  const items = [...messages];
  items.sort((a, b) => {
    let cmp = 0;
    if (sortKey === "date") {
      cmp = a.dateValue - b.dateValue;
    } else if (sortKey === "from") {
      cmp = a.from.localeCompare(b.from);
    } else {
      cmp = a.subject.localeCompare(b.subject);
    }
    return sortDir === "asc" ? cmp : -cmp;
  });
  return items;
}
