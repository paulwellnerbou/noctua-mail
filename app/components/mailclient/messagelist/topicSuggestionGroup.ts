import type { Message, Topic } from "@/lib/data";
import type { MessageGroup } from "./listModel";

export type TopicThreadSuggestion = {
  threadId: string;
  representativeMessageId?: string;
  suggestionScore: number;
};

export const TOPIC_SUGGESTION_GROUP_PREFIX = "topic-suggestions:";
export const TOPIC_SUGGESTION_GROUP_DEFAULT_COLLAPSED = true;

export function buildTopicSuggestionGroupKey(topicId: string) {
  const normalizedTopicId = topicId.trim();
  return normalizedTopicId ? `${TOPIC_SUGGESTION_GROUP_PREFIX}${normalizedTopicId}` : "";
}

export function isTopicSuggestionGroupKey(groupKey: string | null | undefined) {
  return typeof groupKey === "string" && groupKey.startsWith(TOPIC_SUGGESTION_GROUP_PREFIX);
}

export function buildTopicSuggestionCollapsedStorageKey(accountId: string) {
  return `topic-suggestion-group-collapsed:${accountId.trim()}`;
}

export function readTopicSuggestionGroupCollapsed(accountId: string) {
  if (typeof window === "undefined") return TOPIC_SUGGESTION_GROUP_DEFAULT_COLLAPSED;
  const storageKey = buildTopicSuggestionCollapsedStorageKey(accountId);
  const storedValue = window.localStorage.getItem(storageKey);
  if (storedValue === "0") return false;
  if (storedValue === "1") return true;
  return TOPIC_SUGGESTION_GROUP_DEFAULT_COLLAPSED;
}

export function buildTopicSuggestionRankedMessages(
  messages: Message[],
  suggestions: TopicThreadSuggestion[]
) {
  if (messages.length === 0 || suggestions.length === 0) return [];

  const rankByThreadId = new Map<string, number>();
  suggestions.forEach((suggestion, index) => {
    const threadId = suggestion.threadId.trim();
    if (!threadId || rankByThreadId.has(threadId)) return;
    rankByThreadId.set(threadId, suggestions.length - index);
  });

  const deduped = new Map<string, Message>();
  messages.forEach((message) => {
    const threadId = String(message.threadId ?? "").trim();
    const rank = rankByThreadId.get(threadId);
    if (!threadId || rank === undefined || deduped.has(message.id)) return;
    deduped.set(message.id, {
      ...message,
      threadSortDateValue: Date.now() + rank * 1000
    });
  });

  return Array.from(deduped.values());
}

export function pruneTopicSuggestionMessages(params: {
  messages: Message[];
  suggestions: TopicThreadSuggestion[];
  removedMessageIds: string[];
}) {
  const removedIdSet = new Set(
    params.removedMessageIds
      .map((id) => id.trim())
      .filter(Boolean)
  );
  if (removedIdSet.size === 0) {
    return {
      messages: params.messages,
      suggestions: params.suggestions,
      changed: false
    };
  }

  const nextMessages = params.messages.filter((message) => !removedIdSet.has(message.id));
  if (nextMessages.length === params.messages.length) {
    return {
      messages: params.messages,
      suggestions: params.suggestions,
      changed: false
    };
  }

  const remainingThreadIds = new Set(
    nextMessages
      .map((message) => String(message.threadId ?? "").trim())
      .filter(Boolean)
  );
  const nextSuggestions = params.suggestions.filter((suggestion) =>
    remainingThreadIds.has(suggestion.threadId.trim())
  );

  return {
    messages: nextMessages,
    suggestions: nextSuggestions,
    changed:
      nextMessages.length !== params.messages.length ||
      nextSuggestions.length !== params.suggestions.length
  };
}

export function shouldRenderTopicSuggestionGroup(params: {
  enabled: boolean;
  rankedMessages: Message[];
  isLoading: boolean;
  isLoaded: boolean;
}) {
  if (!params.enabled) return false;
  return params.rankedMessages.length > 0 || params.isLoading || !params.isLoaded;
}

export function buildTopicSuggestionGroup(params: {
  topic: Topic | null;
  rankedMessages: Message[];
}): MessageGroup[] {
  const { topic, rankedMessages } = params;
  if (!topic) return [];

  return [
    {
      key: buildTopicSuggestionGroupKey(topic.id),
      label: topic.name,
      items: rankedMessages,
      showCount: false,
      allowToggleWhenEmpty: true,
      variant: "topic-suggestions"
    }
  ];
}
