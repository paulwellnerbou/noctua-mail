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
 * The message-view pane: toolbar + optional thread-subject/topic header +
 * the `ThreadView` tree that renders the active message / thread. This
 * component composes the subtree so MailClient renders a single
 * `<MessageViewOrchestrator {...} />` rather than assembling the block
 * inline alongside its own top-level state.
 *
 * Owns `threadViewMode` ("compact" | "full") because it's the only
 * consumer — the Compact/Full SegmentedControl in the header toggles it,
 * and the ThreadView subtree reads it through `messageCardProps`. The
 * default stays "compact" to match pre-split behavior.
 *
 * DEVIATION (phase 5a — intentional temporary scope):
 *   - `messageTabs` stays in MailClient. `ComposeOrchestrator` reads it
 *     when selecting a preferred compose tab, so it's cross-pane.
 *   - `collapsedMessages` stays in MailClient. A MailClient-level effect
 *     auto-collapses siblings when the compose-thread-focus message
 *     changes, and `scheduleActiveMessageScroll` reads
 *     `collapsedMessagesRef` to decide whether to settle before
 *     scrolling. Both tie it to compose placement and list selection.
 *   - `messageFontScale` stays in MailClient. The `renderMarkdownPanel`
 *     helper (assembled at MailClient level) captures it by value.
 *   - `messageZoom` / `adjustMessageZoom` / `resetMessageZoom` stay in
 *     MailClient. The setter is called from `evictMessageCaches`, which
 *     is MailClient-level and cross-pane.
 *   - Topic-explanation state / handlers (`topicSuggestionExplanation*`,
 *     `handleLoadTopicSuggestionExplanation`,
 *     `handleToggleActiveMessageTopic`) are a substantial API surface
 *     and move in a later sub-phase.
 *   - Inline compose placement still depends on the shell-level
 *     `ComposeOrchestratorHandle`, so the handle ref stays owned by
 *     MailClient. This orchestrator calls `renderInlineCard(...)`
 *     through that ref (via the local `renderComposeCard` closure)
 *     when assembling the thread subtree, and consumes the resolved
 *     `inlineComposePlacement` as input. The placement memo itself
 *     moves in a later sub-phase once the compose mirror isn't needed
 *     at the shell for other reasons.
 *
 * Everything else is threaded in as props for phase 5a so the extract is
 * a pure JSX relocation with no behavior change.
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
