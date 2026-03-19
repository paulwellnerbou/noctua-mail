export async function applyActiveTopicSuggestion(params: {
  threadId: string;
  topicId: string;
  persistThreadTopics: (threadId: string, topicIds: string[]) => Promise<void>;
  refreshMailboxData: () => Promise<boolean>;
  refreshSuggestions: () => Promise<void>;
}) {
  const normalizedThreadId = params.threadId.trim();
  const normalizedTopicId = params.topicId.trim();
  if (!normalizedThreadId || !normalizedTopicId) return;

  await params.persistThreadTopics(normalizedThreadId, [normalizedTopicId]);
  await params.refreshMailboxData();
  await params.refreshSuggestions();
}
