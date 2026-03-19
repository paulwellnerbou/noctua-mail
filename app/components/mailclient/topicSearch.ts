export type SimpleTopicSearchMode = {
  topicId: string;
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

  return { topicId: topicIds[0] };
}
