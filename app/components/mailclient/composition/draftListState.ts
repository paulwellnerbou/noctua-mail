import type { Message } from "@/lib/data";

export function reconcileSavedDraftMessages({
  messages,
  savedDraft,
  previousDraftId,
  includeSavedDraft
}: {
  messages: Message[];
  savedDraft: Message;
  previousDraftId: string | null;
  includeSavedDraft: boolean;
}) {
  const excludedIds = new Set<string>([savedDraft.id]);
  if (previousDraftId) {
    excludedIds.add(previousDraftId);
  }

  const nextMessages = messages.filter((message) => !excludedIds.has(message.id));
  if (!includeSavedDraft) {
    return nextMessages;
  }

  return [...nextMessages, savedDraft];
}
