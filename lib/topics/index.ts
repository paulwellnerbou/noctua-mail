// Public API for @/lib/topics.
//
// Implementation is split across three sibling files:
//   - core.ts: CRUD, thread assignment, per-topic stats, shared helpers
//   - suggestions.ts: scoring / ranking / explanation based on the learning corpus
//   - transfer.ts: export / import of the full topic dataset
//
// Prefer importing from "@/lib/topics" rather than the sibling files directly;
// the re-exports here keep the surface stable for the rest of the codebase.

export type { TopicSignalStat, TopicStat } from "./core";
export {
  addThreadTopic,
  createTopic,
  deleteTopic,
  excludeTopicLearningSignal,
  getTopicById,
  getTopicStats,
  getTopicsForThread,
  getTopicsForThreads,
  listTopics,
  removeThreadTopic,
  setThreadTopics,
  updateTopic
} from "./core";

export type {
  TopicSuggestionExplanation,
  TopicSuggestionExplanationSignal,
  TopicSuggestionExplanationTopic,
  TopicThreadSuggestion
} from "./suggestions";
export {
  getTopicSuggestionExplanationForThread,
  getTopicSuggestionsForMessage,
  getTopicSuggestionsForThread,
  getTopicSuggestionsForThreads,
  getTopicThreadSuggestions
} from "./suggestions";

export type {
  TopicTransferData,
  TopicTransferImportSummary,
  TopicTransferLearningSignal,
  TopicTransferThread,
  TopicTransferTopic
} from "./transfer";
export {
  exportTopicTransferData,
  importTopicTransferData
} from "./transfer";
