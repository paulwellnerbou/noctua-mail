import type { Message } from "@/lib/data";
import { pruneDetachedCrossFolderThreadMessages } from "../utils/messageMutation";

type DraftListPruneOptions = {
  searchScope: "folder" | "all";
  activeFolderId: string;
  includeThreadAcrossFoldersForList: boolean;
};

export function reconcileSavedDraftMessages({
  messages,
  savedDraft,
  previousDraftId,
  includeSavedDraft,
  pruneOptions
}: {
  messages: Message[];
  savedDraft: Message;
  previousDraftId: string | null;
  includeSavedDraft: boolean;
  pruneOptions?: DraftListPruneOptions;
}) {
  const excludedIds = new Set<string>([savedDraft.id]);
  if (previousDraftId) {
    excludedIds.add(previousDraftId);
  }

  const nextMessages = messages.filter((message) => !excludedIds.has(message.id));
  const reconciledMessages = includeSavedDraft ? [...nextMessages, savedDraft] : nextMessages;
  if (!pruneOptions) {
    return reconciledMessages;
  }

  return pruneDetachedCrossFolderThreadMessages(reconciledMessages, pruneOptions);
}
