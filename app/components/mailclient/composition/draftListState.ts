import type { Message } from "@/lib/data";
import { buildMessageGroupKey } from "@/lib/messageGrouping";
import {
  isThreadDateSensitiveGroupBy,
  type ThreadDateSource
} from "@/lib/threadDate";
import { pruneDetachedCrossFolderThreadMessages } from "../utils/messageMutation";

type DraftListPruneOptions = {
  searchScope: "folder" | "all";
  activeFolderId: string;
  includeThreadAcrossFoldersForList: boolean;
};

function findExistingThreadSortDateValue({
  messages,
  savedDraft,
  previousDraftId
}: {
  messages: Message[];
  savedDraft: Message;
  previousDraftId: string | null;
}) {
  if (!savedDraft.threadId) return undefined;
  const excludedIds = new Set<string>([savedDraft.id]);
  if (previousDraftId) {
    excludedIds.add(previousDraftId);
  }
  const existing = messages.find((message) => {
    if (excludedIds.has(message.id)) return false;
    if (message.threadId !== savedDraft.threadId) return false;
    return Number.isFinite(Number(message.threadSortDateValue));
  });
  return existing?.threadSortDateValue;
}

export function buildSavedDraftListMessage({
  messages,
  savedDraft,
  previousDraftId,
  groupBy,
  threadDateSource
}: {
  messages: Message[];
  savedDraft: Message;
  previousDraftId: string | null;
  groupBy: string;
  threadDateSource: ThreadDateSource;
}) {
  const preservedThreadSortDateValue =
    threadDateSource === "latestReceivedDateValue"
      ? findExistingThreadSortDateValue({ messages, savedDraft, previousDraftId })
      : undefined;
  const threadSortDateValue = Number.isFinite(Number(savedDraft.threadSortDateValue))
    ? Number(savedDraft.threadSortDateValue)
    : preservedThreadSortDateValue;
  const groupDateValueOverride =
    threadDateSource === "latestReceivedDateValue" && isThreadDateSensitiveGroupBy(groupBy)
      ? threadSortDateValue
      : undefined;

  return {
    ...savedDraft,
    ...(Number.isFinite(threadSortDateValue) ? { threadSortDateValue } : {}),
    groupKey: buildMessageGroupKey(savedDraft, groupBy, groupDateValueOverride)
  };
}

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

  const hasExistingSavedDraft = messages.some((message) => excludedIds.has(message.id));
  if (!hasExistingSavedDraft && !includeSavedDraft) {
    return messages;
  }

  const nextMessages = messages.filter((message) => !excludedIds.has(message.id));
  const reconciledMessages = includeSavedDraft ? [...nextMessages, savedDraft] : nextMessages;
  if (!pruneOptions) {
    return reconciledMessages;
  }

  return pruneDetachedCrossFolderThreadMessages(reconciledMessages, pruneOptions);
}
