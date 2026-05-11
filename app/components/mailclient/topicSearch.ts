import { TOPIC_NONE_SENTINEL, isTopicNoneSentinel } from "@/lib/topics/searchSentinels";

export type SimpleTopicSearchMode = {
  topicId: string;
  noTopicFilter?: boolean;
};

const TOPIC_TERM_PATTERN = /(^|\s)topic:("([^"]+)"|\S+)/gi;

export function parseSimpleTopicSearchMode(query: string | null | undefined): SimpleTopicSearchMode | null {
  const input = (query ?? "").trim();
  if (!input) return null;

  const topicIds: string[] = [];
  const remainder = input.replace(TOPIC_TERM_PATTERN, (_match, lead, term) => {
    const cleaned = String(term ?? "").replace(/^"|"$/g, "").trim();
    if (cleaned) {
      topicIds.push(cleaned);
    }
    return lead ? " " : "";
  });

  if (topicIds.length !== 1) return null;
  if (remainder.trim().length > 0) return null;

  if (isTopicNoneSentinel(topicIds[0])) {
    return { topicId: TOPIC_NONE_SENTINEL, noTopicFilter: true };
  }
  return { topicId: topicIds[0] };
}
