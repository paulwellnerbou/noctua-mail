import { getTopicSuggestionsForThreads, getTopicsForThreads } from "@/lib/topics";
import type { Message, Topic } from "@/lib/data";

type TopicLoader = (
  accountId: string,
  threadIds: string[]
) => Promise<Map<string, Topic[]>>;

type SuggestionLoader = (
  accountId: string,
  threadIds: string[],
  options?: { accountEmail?: string | null }
) => Promise<Map<string, Topic[]>>;

type EnrichMessagesWithThreadTopicsOptions = {
  accountId: string;
  includeSuggestions?: boolean;
  accountEmail?: string | null;
  loadTopicsForThreads?: TopicLoader;
  loadTopicSuggestionsForThreads?: SuggestionLoader;
};

export async function enrichMessagesWithThreadTopics(
  items: Message[],
  options: EnrichMessagesWithThreadTopicsOptions
) {
  const threadIds = Array.from(
    new Set(items.map((item) => item.threadId?.trim()).filter(Boolean))
  );
  if (threadIds.length === 0) return;

  const loadTopicsForThreads = options.loadTopicsForThreads ?? getTopicsForThreads;
  const loadTopicSuggestionsForThreads =
    options.loadTopicSuggestionsForThreads ?? getTopicSuggestionsForThreads;

  const topicsByThreadId = await loadTopicsForThreads(options.accountId, threadIds);
  const shouldLoadSuggestions = options.includeSuggestions && options.accountEmail;
  const suggestionThreadIds = shouldLoadSuggestions
    ? threadIds.filter((threadId) => (topicsByThreadId.get(threadId)?.length ?? 0) === 0)
    : [];
  const suggestionsByThreadId =
    suggestionThreadIds.length > 0
      ? await loadTopicSuggestionsForThreads(options.accountId, suggestionThreadIds, {
          accountEmail: options.accountEmail
        })
      : new Map<string, Topic[]>();

  for (const item of items) {
    const threadId = item.threadId?.trim();
    if (!threadId) continue;
    item.topics = topicsByThreadId.get(threadId) ?? [];
    if (shouldLoadSuggestions && item.topics.length === 0) {
      item.topicSuggestions = suggestionsByThreadId.get(threadId) ?? [];
    }
  }
}
