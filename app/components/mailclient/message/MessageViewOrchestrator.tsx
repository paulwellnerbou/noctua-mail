"use client";

import type React from "react";
import { useState } from "react";
import { Flex, SegmentedControl } from "@radix-ui/themes";
import type { Message, Topic } from "@/lib/data";

import MessageViewPane from "./MessageViewPane";
import ThreadView from "./ThreadView";
import type { ThreadMessageCardProps } from "./ThreadMessageCard";
import ThreadTopicSuggestionsRow from "./ThreadTopicSuggestionsRow";
import TopicBadge from "../TopicBadge";
import threadViewStyles from "./ThreadView.module.css";
import type { ComposeOrchestratorHandle } from "../composition/ComposeOrchestrator";
import type { TopicSuggestionExplanation } from "./types";

/**
 * The message-view pane: toolbar + optional thread-subject/topic header
 * + the `ThreadView` subtree that renders the active message or thread.
 *
 * Owns `threadViewMode` ("compact" | "full") because the Compact/Full
 * SegmentedControl in the header toggles it and the `ThreadView`
 * subtree reads it through `messageCardProps` — no consumer outside
 * this component. Default "compact".
 *
 * The rest of the message-view-ish state lives at the MailClient shell
 * because each piece has consumers outside this pane:
 *   - `messageTabs` — `ComposeOrchestrator` reads it to pick a preferred
 *     compose tab.
 *   - `collapsedMessages` — a shell-level effect auto-collapses siblings
 *     on compose-thread-focus change, and `scheduleActiveMessageScroll`
 *     reads `collapsedMessagesRef` to decide whether to settle the
 *     layout before scrolling.
 *   - `messageFontScale` — captured by value in `renderMarkdownPanel`,
 *     which is assembled at the shell.
 *   - `messageZoom` and its setters — `evictMessageCaches` (shell-level,
 *     cross-pane) resets the zoom.
 *   - Topic-explanation state and handlers — the API surface spans the
 *     shell's `handleLoadTopicSuggestionExplanation` and
 *     `handleToggleActiveMessageTopic`, which touch data fetchers and
 *     active-message state the shell owns.
 *   - `inlineComposePlacement` and the `ComposeOrchestratorHandle` that
 *     services it — the handle ref sits at the shell and the placement
 *     memo depends on the compose mirror there. This orchestrator calls
 *     `renderInlineCard(...)` through the handle when assembling the
 *     thread subtree and consumes the resolved placement as input.
 */

export type MessageViewOrchestratorHeaderInputs = {
  // Used to compute thread topics / fallback thread-subject source.
  activeMessage: Message | null;
  // The visible thread messages — drives root-subject resolution and the
  // visible-topic-suggestions fallback chain.
  activeThread: Message[];
  getAssignedThreadTopics: (message: Message) => Topic[];
  // Topic-explanation popover state. Still owned by MailClient for phase
  // 5a — see the class-level deviation note.
  topicSuggestionExplanationOpen: boolean;
  topicSuggestionExplanationLoading: boolean;
  topicSuggestionExplanationError: string;
  topicSuggestionExplanation: TopicSuggestionExplanation | null;
  setTopicSuggestionExplanationOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleLoadTopicSuggestionExplanation: (threadId: string) => Promise<void> | void;
  handleToggleActiveMessageTopic: (topicId: string) => void;
};

export type MessageViewOrchestratorBodyInputs = {
  // Inline-compose placement is computed in MailClient (depends on the
  // compose handle ref and compose mirror). For phase 5a the orchestrator
  // just consumes the resolved placement.
  composeHandleRef: React.MutableRefObject<ComposeOrchestratorHandle | null>;
  inlineComposePlacement: {
    showComposeAtTop: boolean;
    composeReplyMessageId: string | null;
    replyMessageInThread?: boolean;
  };
  showComposeInline: boolean;
  supportsThreads: boolean;
  threadContentById: Record<string, Message[]>;
  threadContentLoading: string | null;
  threadContentErrorById: Record<string, string>;
  composeDraftId: string | null;
  activeAccountId: string;
  // The base message-id -> message map. The orchestrator enhances this
  // locally with the active thread (so "In Reply To" links resolve when
  // viewing from Drafts etc.), mirroring the pre-split behavior.
  messageByMessageId: Map<string, Message>;
  // Everything else needed by ThreadMessageCard — threaded through
  // unchanged. `message` is injected per-row by ThreadView;
  // `threadViewMode` is merged in by this orchestrator so callers don't
  // pass it; `messageByMessageId` is merged in too — the orchestrator
  // enhances the base map supplied above with entries from
  // `activeThread` so "In Reply To" links resolve when viewing from any
  // folder (e.g. Drafts).
  messageCardProps: Omit<
    ThreadMessageCardProps,
    "message" | "threadViewMode" | "messageByMessageId"
  >;
};

export type MessageViewOrchestratorProps = {
  // Toolbar actions.
  onShowJson: () => void;
  onEvictThreadCache: () => void;

  // Header + body input bags. Split purely for readability — the
  // orchestrator itself doesn't treat them differently.
  header: MessageViewOrchestratorHeaderInputs;
  body: MessageViewOrchestratorBodyInputs;
};

export default function MessageViewOrchestrator({
  onShowJson,
  onEvictThreadCache,
  header,
  body
}: MessageViewOrchestratorProps) {
  const [threadViewMode, setThreadViewMode] = useState<"full" | "compact">("compact");

  const {
    activeMessage,
    activeThread,
    getAssignedThreadTopics,
    topicSuggestionExplanationOpen,
    topicSuggestionExplanationLoading,
    topicSuggestionExplanationError,
    topicSuggestionExplanation,
    setTopicSuggestionExplanationOpen,
    handleLoadTopicSuggestionExplanation,
    handleToggleActiveMessageTopic
  } = header;

  const {
    composeHandleRef,
    inlineComposePlacement,
    showComposeInline,
    supportsThreads,
    threadContentById,
    threadContentLoading,
    threadContentErrorById,
    composeDraftId,
    activeAccountId,
    messageByMessageId,
    messageCardProps
  } = body;

  return (
    <MessageViewPane
      onShowJson={onShowJson}
      onEvictThreadCache={onEvictThreadCache}
      header={activeMessage ? (() => {
              const rootSubject =
                activeThread[0]?.subject ?? activeMessage?.subject ?? "";
              const threadTopics = getAssignedThreadTopics(activeMessage);
              const threadSuggestions =
                threadTopics.length > 0
                  ? []
                  : activeThread.find(
                      (item) =>
                        item.threadId === activeMessage.threadId &&
                        (item.topicSuggestions?.length ?? 0) > 0
                    )?.topicSuggestions ??
                    activeMessage.topicSuggestions ??
                    [];
              const visibleThreadSuggestions = threadSuggestions.filter(
                (topic) =>
                  typeof topic?.id === "string" &&
                  topic.id.trim().length > 0 &&
                  typeof topic?.name === "string" &&
                  topic.name.trim().length > 0
              );
              const explanationThreadId = activeMessage.threadId ?? "";
              return (
                <Flex direction="column" gap="2" style={{ flex: 1, minWidth: 0 }}>
                  <Flex align="center" gap="3">
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 16, lineHeight: 1.4, wordBreak: "break-word", overflowWrap: "anywhere", color: "var(--gray-12)" }}>
                      {rootSubject || "(no subject)"}
                    </span>
                    <SegmentedControl.Root
                      size="1"
                      value={threadViewMode}
                      onValueChange={(v) => setThreadViewMode(v as "full" | "compact")}
                      style={{ flexShrink: 0 }}
                    >
                      <SegmentedControl.Item value="compact">Compact</SegmentedControl.Item>
                      <SegmentedControl.Item value="full">Full</SegmentedControl.Item>
                    </SegmentedControl.Root>
                  </Flex>
                  {threadTopics.length > 0 && (
                    <Flex gap="1" wrap="wrap" justify="end">
                      {threadTopics.map((topic) => (
                        <TopicBadge key={topic.id} topic={topic} size="1" />
                      ))}
                    </Flex>
                  )}
                  <ThreadTopicSuggestionsRow
                    threadId={explanationThreadId}
                    hasAssignedTopics={threadTopics.length > 0}
                    suggestions={visibleThreadSuggestions}
                    explanationOpen={topicSuggestionExplanationOpen}
                    explanationLoading={topicSuggestionExplanationLoading}
                    explanationError={topicSuggestionExplanationError}
                    explanation={topicSuggestionExplanation}
                    onExplanationOpenChange={setTopicSuggestionExplanationOpen}
                    onLoadExplanation={(threadId) => {
                      void handleLoadTopicSuggestionExplanation(threadId);
                    }}
                    onToggleTopic={handleToggleActiveMessageTopic}
                  />
                </Flex>
              );
            })() : undefined
      }
    >
        {(() => {
          // The orchestrator owns the inline card; MailClient just asks it
          // to render at the appropriate slots.
          const renderComposeCard = (wrapperClassName?: string) =>
            composeHandleRef.current?.renderInlineCard(wrapperClassName) ?? null;

          // Enhance messageByMessageId with messages from activeThread
          // (so "In Reply To" links work when viewing from any folder, e.g., Drafts)
          const enhancedMessageByMessageId = new Map(messageByMessageId);
          activeThread.forEach((message) => {
            if (message.messageId && message.accountId === activeAccountId) {
              enhancedMessageByMessageId.set(message.messageId, message);
            }
          });

          return (
            <>
              {inlineComposePlacement.showComposeAtTop &&
                renderComposeCard(activeThread.length > 0 ? threadViewStyles.threadItem : undefined)}
              <ThreadView
                showComposeInline={showComposeInline}
                activeMessage={activeMessage ?? null}
                activeThread={activeThread}
                supportsThreads={supportsThreads}
                threadContentById={threadContentById}
                threadContentLoading={threadContentLoading}
                threadContentErrorById={threadContentErrorById}
                composeDraftId={composeDraftId}
                composeReplyMessageId={inlineComposePlacement.composeReplyMessageId}
                renderComposeInlineCard={
                  inlineComposePlacement.composeReplyMessageId ? renderComposeCard : null
                }
                messageCardProps={{
                  ...messageCardProps,
                  messageByMessageId: enhancedMessageByMessageId,
                  threadViewMode
                }}
              />
            </>
          );
        })()}
    </MessageViewPane>
  );
}
