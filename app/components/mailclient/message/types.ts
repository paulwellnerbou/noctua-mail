import type { Topic } from "@/lib/data";

/**
 * Shape of the `/api/.../topics/[id]/suggestions/explain` response as
 * consumed by the UI. Shared between the state owner (`MailClient`), the
 * orchestrator that passes it down (`MessageViewOrchestrator`), and the
 * popover that renders it (`ThreadTopicSuggestionsRow`) so the three
 * cannot drift.
 */
export type TopicSuggestionExplanation = {
  signals: Array<{ type: string; value: string; weight: number }>;
  topics: Array<{
    topic: Topic;
    suggestionScore: number;
    matchCount: number;
    matchedSignals: Array<{ type: string; value: string; weight: number }>;
    matchedThreads: Array<{
      threadId: string;
      score: number;
      signals: Array<{ type: string; value: string; weight: number }>;
    }>;
  }>;
};
