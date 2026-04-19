"use client";

import { memo, useMemo } from "react";
import { QuestionMarkCircledIcon } from "@radix-ui/react-icons";
import { Flex, IconButton, Popover, Text } from "@radix-ui/themes";
import type { Topic } from "@/lib/data";
import TopicBadge from "../TopicBadge";
import type { TopicSuggestionExplanation } from "./types";

type ThreadTopicSuggestionsRowProps = {
  threadId: string;
  hasAssignedTopics: boolean;
  suggestions: Topic[];
  explanationOpen: boolean;
  explanationLoading: boolean;
  explanationError: string;
  explanation: TopicSuggestionExplanation | null;
  onExplanationOpenChange: (open: boolean) => void;
  onLoadExplanation: (threadId: string) => void;
  onToggleTopic: (topicId: string) => void;
};

function normalizeSuggestions(suggestions: Topic[]) {
  return suggestions.filter(
    (topic) =>
      typeof topic?.id === "string" &&
      topic.id.trim().length > 0 &&
      typeof topic?.name === "string" &&
      topic.name.trim().length > 0
  );
}

function formatTopicSuggestionScore(score?: number) {
  if (score === undefined) return null;
  return Number.isInteger(score) ? String(score) : score.toFixed(2);
}

function formatTopicSuggestionSignal(signal: { type: string; value: string; weight: number }) {
  return `${signal.type}=${signal.value} (${signal.weight})`;
}

function formatTopicSuggestionFormula(
  signals: Array<{ type: string; value: string; weight: number }>
) {
  if (signals.length === 0) return "0";
  return signals
    .map((signal) => `${signal.weight} (${signal.type}=${signal.value})`)
    .join(" + ");
}

function buildSuggestionSignature(suggestions: Topic[]) {
  return suggestions
    .map((topic) => `${topic.id}:${topic.suggestionScore ?? ""}:${topic.name}`)
    .join("|");
}

function ThreadTopicSuggestionsRow({
  threadId,
  hasAssignedTopics,
  suggestions,
  explanationOpen,
  explanationLoading,
  explanationError,
  explanation,
  onExplanationOpenChange,
  onLoadExplanation,
  onToggleTopic
}: ThreadTopicSuggestionsRowProps) {
  const visibleSuggestions = useMemo(() => normalizeSuggestions(suggestions), [suggestions]);
  const displayedSuggestions = hasAssignedTopics ? [] : visibleSuggestions;

  if (displayedSuggestions.length === 0) {
    return null;
  }

  return (
    <Flex align="center" gap="2" wrap="wrap" justify="start" style={{ width: "100%" }}>
      <Text size="1" color="gray">
        Topic suggestion:
      </Text>
      {displayedSuggestions.map((topic) => {
        const scoreLabel = formatTopicSuggestionScore(topic.suggestionScore);
        return (
          <Flex
            key={topic.id}
            align="center"
            gap="1"
            style={{ cursor: "pointer" }}
            onClick={() => {
              onToggleTopic(topic.id);
            }}
          >
            <TopicBadge topic={topic} size="1" />
            {scoreLabel ? (
              <Text size="1" color="gray">
                ({scoreLabel})
              </Text>
            ) : null}
          </Flex>
        );
      })}
      <Popover.Root
        open={explanationOpen}
        onOpenChange={(open) => {
          onExplanationOpenChange(open);
          if (open && threadId) {
            onLoadExplanation(threadId);
          }
        }}
      >
        <Popover.Trigger>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            title="Why?"
            aria-label="Why?"
          >
            <QuestionMarkCircledIcon width={14} height={14} />
          </IconButton>
        </Popover.Trigger>
        <Popover.Content size="1" className="topic-suggestion-explanation-popover">
          <Flex direction="column" gap="3" className="topic-suggestion-explanation-layout">
            <Text size="2" weight="medium">
              Why this suggestion?
            </Text>
            <Flex direction="column" gap="3" className="topic-suggestion-explanation-body">
              {explanationLoading ? (
                <Text size="1" color="gray">
                  Loading explanation…
                </Text>
              ) : explanationError ? (
                <Text size="1" color="red">
                  {explanationError}
                </Text>
              ) : explanation ? (
                <>
                  <Flex direction="column" gap="1">
                    <Text size="1" color="gray">
                      Numbers in parentheses are signal weights, not mail counts.
                    </Text>
                    <Text size="1" color="gray">
                      Per matching historical thread: <code>thread score = sum(signal weights)</code>
                    </Text>
                    <Text size="1" color="gray">
                      Per topic: <code>suggestion score = sum(thread scores)</code>, <code>match count = number of matching historical threads</code>
                    </Text>
                  </Flex>
                  <Flex direction="column" gap="1">
                    <Text size="1" weight="medium">
                      Current thread signals
                    </Text>
                    {explanation.signals.length > 0 ? (
                      explanation.signals.map((signal) => (
                        <Text key={`${signal.type}-${signal.value}`} size="1" color="gray">
                          {formatTopicSuggestionSignal(signal)}
                        </Text>
                      ))
                    ) : (
                      <Text size="1" color="gray">
                        No learned signals available.
                      </Text>
                    )}
                  </Flex>
                  <Flex direction="column" gap="3">
                    {explanation.topics.map((entry) => (
                      <Flex key={entry.topic.id} direction="column" gap="1">
                        <Text size="1" weight="medium">
                          {entry.topic.name}: score {entry.suggestionScore}, matches {entry.matchCount}
                        </Text>
                        <Text size="1" color="gray">
                          Best matching thread decides the score; extra matches only break ties.
                          {entry.matchedThreads[0]
                            ? ` Winner: ${entry.matchedThreads[0].threadId} (${entry.matchedThreads[0].score})`
                            : ""}
                        </Text>
                        {entry.matchedThreads.map((thread) => (
                          <Flex key={`${entry.topic.id}-${thread.threadId}`} direction="column" gap="1">
                            <Text size="1" color="gray">
                              {thread.threadId}: {formatTopicSuggestionFormula(thread.signals)} = {thread.score}
                            </Text>
                            <Text size="1" color="gray">
                              Signals: {thread.signals.map((signal) => formatTopicSuggestionSignal(signal)).join(", ")}
                            </Text>
                          </Flex>
                        ))}
                      </Flex>
                    ))}
                  </Flex>
                </>
              ) : (
                <Text size="1" color="gray">
                  No explanation available.
                </Text>
              )}
            </Flex>
          </Flex>
        </Popover.Content>
      </Popover.Root>
    </Flex>
  );
}

export default memo(ThreadTopicSuggestionsRow, (prev, next) => {
  return (
    prev.threadId === next.threadId &&
    prev.hasAssignedTopics === next.hasAssignedTopics &&
    buildSuggestionSignature(prev.suggestions) === buildSuggestionSignature(next.suggestions) &&
    prev.explanationOpen === next.explanationOpen &&
    prev.explanationLoading === next.explanationLoading &&
    prev.explanationError === next.explanationError &&
    prev.explanation === next.explanation
  );
});
