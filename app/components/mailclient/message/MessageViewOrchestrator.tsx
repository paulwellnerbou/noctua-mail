"use client";

import type React from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";
import { Flex, SegmentedControl } from "@radix-ui/themes";
import type { Message, Topic } from "@/lib/data";

import MessageViewPane from "./MessageViewPane";
import ThreadView from "./ThreadView";
import type { ThreadMessageCardProps } from "./ThreadMessageCard";
import ThreadTopicSuggestionsRow from "./ThreadTopicSuggestionsRow";
import TopicBadge from "../TopicBadge";
import threadViewStyles from "./ThreadView.module.css";
import { renderMarkdownPanel as renderMarkdownPanelHelper } from "../RenderHelpers";
import type { ComposeOrchestratorHandle } from "../composition/ComposeOrchestrator";
import type { TopicSuggestionExplanation } from "./types";
import { buildAccountMessageTopicSuggestionExplainPath } from "@/lib/accountApiPaths";

/**
 * The message-view pane: toolbar + optional thread-subject/topic header
 * + the `ThreadView` subtree that renders the active message or thread.
 *
 * Owns `threadViewMode` ("compact" | "full") because the Compact/Full
 * SegmentedControl in the header toggles it and the `ThreadView`
 * subtree reads it through `messageCardProps` — no consumer outside
 * this component. Default "compact".
 *
 * Owns the topic-suggestion explanation popover state (`open`,
 * `loading`, `error`, `explanation`, and the in-flight `threadId` used
 * to dedupe reloads) because the popover only appears inside the
 * thread-subject header rendered here, and the only writer is the
 * `handleLoadTopicSuggestionExplanation` callback also defined here.
 * The popover resets whenever `activeMessage?.threadId` changes, via a
 * local effect — the `activeMessage` arrives through `header`.
 * `handleLoadTopicSuggestionExplanation` takes `apiFetch` and
 * `activeAccountId` as inputs (both shell-owned singletons) to hit the
 * explain endpoint without depending on the shell's callback identity.
 *
 * Owns the per-message `messageFontScale` and `messageZoom` maps along
 * with the `adjustMessageZoom` / `resetMessageZoom` setters. The maps
 * are read and mutated only by `ThreadMessageCard` rows rendered in
 * this subtree, so the orchestrator merges them and their setters into
 * `messageCardProps` alongside `threadViewMode`. It also builds the
 * `renderMarkdownPanel` closure locally because the closure's only
 * input is `messageFontScale` and its only consumer is the same card.
 * The shell-level `evictMessageCaches` helper clears per-id entries
 * from both maps via the `evictZoomAndFontScale` method exposed on
 * `MessageViewOrchestratorHandle`.
 *
 * Owns the per-message `messageTabs` map (which body panel — html /
 * text / markdown / source — is currently selected for each message).
 * The primary writer is `ThreadMessageCard`, which receives the map
 * and its setter through `messageCardProps`. `ComposeOrchestrator`
 * also reads the selection when opening a reply / forward to carry
 * the user's preferred rendering across to the compose editor; that
 * cross-pane read is exposed as `getMessageTab` on the handle and
 * returns the normalized editor-eligible value (excluding "source") or
 * undefined. `evictMessageTabs` on the handle clears per-id entries
 * from the shell's `evictMessageCaches` helper.
 *
 * The rest of the message-view-ish state lives at the MailClient shell
 * because each piece has consumers outside this pane:
 *   - `collapsedMessages` — a shell-level effect auto-collapses siblings
 *     on compose-thread-focus change, and `scheduleActiveMessageScroll`
 *     reads `collapsedMessagesRef` to decide whether to settle the
 *     layout before scrolling.
 *   - Thread-topic assignment (`onToggleTopic`) — mutates
 *     `messageTopicsById` at the shell and refreshes active-topic-mode
 *     results; the orchestrator calls it with the active message to
 *     toggle a topic.
 *   - `inlineComposePlacement` and the `ComposeOrchestratorHandle` that
 *     services it — the handle ref sits at the shell and the placement
 *     memo depends on the compose mirror there. This orchestrator calls
 *     `renderInlineCard(...)` through the handle when assembling the
 *     thread subtree and consumes the resolved placement as input.
 */

export type MessageViewOrchestratorHandle = {
  // Clears per-id entries from the orchestrator-local `messageFontScale`
  // and `messageZoom` maps. Called by the shell's cross-pane
  // `evictMessageCaches` helper when a message is moved/deleted/
  // refetched so stale per-id overrides don't outlive the message.
  evictZoomAndFontScale: (messageIds: string[]) => void;
  // Clears per-id entries from the orchestrator-local `messageTabs` map.
  // Separate from `evictZoomAndFontScale` because `messageTabs` tracks
  // the user's selected body panel (a semantic choice) while the zoom
  // and font-scale maps track visual overrides — the shell's
  // `evictMessageCaches` helper fans out to both.
  evictMessageTabs: (messageIds: string[]) => void;
  // Returns the currently selected body panel for `messageId` if it is
  // one of the editor-eligible values ("html", "text", "markdown") —
  // "source" and "unset" both collapse to undefined because they do
  // not translate into a compose-editor preference. Consumed by
  // `ComposeOrchestrator` when opening a reply / forward so the compose
  // surface can match the rendering the user was just looking at.
  getMessageTab: (messageId: string) => "html" | "text" | "markdown" | undefined;
};

export type MessageViewOrchestratorHeaderInputs = {
  // Used to compute thread topics / fallback thread-subject source and
  // also to reset the topic-explanation popover on active-thread change.
  activeMessage: Message | null;
  // The visible thread messages — drives root-subject resolution and the
  // visible-topic-suggestions fallback chain.
  activeThread: Message[];
  getAssignedThreadTopics: (message: Message) => Topic[];
  // Thread-topic toggle callback. The orchestrator binds it to the
  // active message; MailClient owns the underlying `messageTopicsById`
  // map and the refresh of active-topic-mode results.
  onToggleTopic: (message: Message, topicId: string) => void | Promise<void>;
};

export type MessageViewOrchestratorBodyInputs = {
  // Inline-compose placement is computed in MailClient (depends on the
  // compose handle ref and compose mirror). The orchestrator consumes
  // the resolved placement.
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
  // Client-id-injecting fetch wrapper owned by MailClient; used here by
  // the topic-suggestion-explanation loader to hit the per-account
  // explain endpoint.
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  // The base message-id -> message map. The orchestrator enhances this
  // locally with the active thread so "In Reply To" links resolve when
  // viewing from any folder (e.g. Drafts).
  messageByMessageId: Map<string, Message>;
  // Everything else needed by ThreadMessageCard — threaded through
  // unchanged. `message` is injected per-row by ThreadView;
  // `threadViewMode` is merged in by this orchestrator so callers don't
  // pass it; `messageByMessageId` is merged in too — the orchestrator
  // enhances the base map supplied above with entries from
  // `activeThread` so "In Reply To" links resolve when viewing from any
  // folder (e.g. Drafts); the font-scale / zoom / markdown-render props
  // are merged in from orchestrator-local state.
  messageCardProps: Omit<
    ThreadMessageCardProps,
    | "message"
    | "threadViewMode"
    | "messageByMessageId"
    | "messageFontScale"
    | "setMessageFontScale"
    | "messageZoom"
    | "adjustMessageZoom"
    | "resetMessageZoom"
    | "renderMarkdownPanel"
    | "messageTabs"
    | "setMessageTabs"
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

function MessageViewOrchestratorImpl(
  { onShowJson, onEvictThreadCache, header, body }: MessageViewOrchestratorProps,
  ref: React.ForwardedRef<MessageViewOrchestratorHandle>
) {
  const [threadViewMode, setThreadViewMode] = useState<"full" | "compact">("compact");
  const [messageFontScale, setMessageFontScale] = useState<Record<string, number>>({});
  const [messageZoom, setMessageZoom] = useState<Record<string, number>>({});
  const [messageTabs, setMessageTabs] = useState<
    Record<string, "html" | "text" | "markdown" | "source">
  >({});
  // Ref mirror of `messageTabs` so the stable `getMessageTab` handle
  // method (created with empty deps) reads the latest map without
  // rebuilding the handle object on every tab change.
  const messageTabsRef = useRef(messageTabs);
  messageTabsRef.current = messageTabs;

  const renderMarkdownPanel = useCallback(
    (markdownBody: string | undefined, messageId: string) =>
      renderMarkdownPanelHelper(markdownBody, messageId, messageFontScale),
    [messageFontScale]
  );

  const adjustMessageZoom = useCallback((messageId: string, delta: number) => {
    setMessageZoom((prev) => {
      const current = prev[messageId] ?? 1;
      const next = Math.min(1.8, Math.max(0.6, Number((current + delta).toFixed(2))));
      return { ...prev, [messageId]: next };
    });
  }, []);

  const resetMessageZoom = useCallback((messageId: string) => {
    setMessageZoom((prev) => {
      if (!(messageId in prev)) return prev;
      const { [messageId]: _omit, ...rest } = prev;
      return rest;
    });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      evictZoomAndFontScale: (messageIds: string[]) => {
        if (messageIds.length === 0) return;
        const idSet = new Set(messageIds);
        const evict = (prev: Record<string, number>) => {
          // Lazily allocate the new map only if at least one id is
          // actually present, so no-op evictions don't churn memory.
          let next: Record<string, number> | undefined;
          idSet.forEach((id) => {
            if (id in prev) {
              next ??= { ...prev };
              delete next[id];
            }
          });
          return next ?? prev;
        };
        setMessageFontScale(evict);
        setMessageZoom(evict);
      },
      evictMessageTabs: (messageIds: string[]) => {
        if (messageIds.length === 0) return;
        const idSet = new Set(messageIds);
        setMessageTabs((prev) => {
          // Lazily allocate the new map only if at least one id is
          // actually present, so no-op evictions don't churn memory.
          let next: Record<string, "html" | "text" | "markdown" | "source"> | undefined;
          idSet.forEach((id) => {
            if (id in prev) {
              next ??= { ...prev };
              delete next[id];
            }
          });
          return next ?? prev;
        });
      },
      getMessageTab: (messageId: string) => {
        const tab = messageTabsRef.current[messageId];
        return tab === "html" || tab === "markdown" || tab === "text" ? tab : undefined;
      }
    }),
    []
  );

  const {
    activeMessage,
    activeThread,
    getAssignedThreadTopics,
    onToggleTopic
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
    apiFetch,
    messageByMessageId,
    messageCardProps
  } = body;

  const [topicSuggestionExplanationOpen, setTopicSuggestionExplanationOpen] = useState(false);
  const [topicSuggestionExplanationLoading, setTopicSuggestionExplanationLoading] = useState(false);
  const [topicSuggestionExplanationError, setTopicSuggestionExplanationError] = useState("");
  const [topicSuggestionExplanation, setTopicSuggestionExplanation] =
    useState<TopicSuggestionExplanation | null>(null);
  const [topicSuggestionExplanationThreadId, setTopicSuggestionExplanationThreadId] = useState("");
  // Tracks the most recently requested thread-id so responses arriving
  // out of order (user switched threads mid-fetch) can bail before
  // overwriting explanation state with a stale result.
  const explanationRequestThreadIdRef = useRef("");

  const handleLoadTopicSuggestionExplanation = useCallback(async (threadId: string) => {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return;
    // Dedupe only when the same thread already has a result cached or a
    // request in flight. An error from a prior attempt must NOT block a
    // retry — the user needs a way to recover from transient failures.
    if (
      topicSuggestionExplanationThreadId === normalizedThreadId &&
      (topicSuggestionExplanation || topicSuggestionExplanationLoading)
    ) {
      return;
    }
    explanationRequestThreadIdRef.current = normalizedThreadId;
    setTopicSuggestionExplanationThreadId(normalizedThreadId);
    setTopicSuggestionExplanationLoading(true);
    setTopicSuggestionExplanationError("");
    setTopicSuggestionExplanation(null);
    try {
      const params = new URLSearchParams({ threadId: normalizedThreadId });
      const res = await apiFetch(
        buildAccountMessageTopicSuggestionExplainPath(activeAccountId, params),
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      // Bail if the user has switched to a different thread while we were
      // awaiting the response; writing state now would clobber the
      // newer request.
      if (explanationRequestThreadIdRef.current !== normalizedThreadId) return;
      if (!res.ok || !data?.ok) {
        setTopicSuggestionExplanationError(
          typeof data?.message === "string" ? data.message : "Failed to load explanation."
        );
        return;
      }
      setTopicSuggestionExplanation((data.explanation ?? null) as TopicSuggestionExplanation | null);
    } catch {
      if (explanationRequestThreadIdRef.current !== normalizedThreadId) return;
      setTopicSuggestionExplanationError("Failed to load explanation.");
    } finally {
      if (explanationRequestThreadIdRef.current === normalizedThreadId) {
        setTopicSuggestionExplanationLoading(false);
      }
    }
  }, [
    activeAccountId,
    apiFetch,
    topicSuggestionExplanation,
    topicSuggestionExplanationLoading,
    topicSuggestionExplanationThreadId
  ]);

  const handleToggleActiveMessageTopic = useCallback(
    (topicId: string) => {
      if (!activeMessage) return;
      void onToggleTopic(activeMessage, topicId);
    },
    [activeMessage, onToggleTopic]
  );

  useEffect(() => {
    // Close the popover when the active thread or account changes.
    // Also invalidate the in-flight fetch key so any pending response
    // bails before writing state, and clear loading/error so a bailed
    // response can't leave a stuck spinner or a stale error message
    // behind. The cached explanation
    // (`topicSuggestionExplanation` + `topicSuggestionExplanationThreadId`)
    // is preserved across thread switches within the same account so
    // reopening the popover on a previously-explained thread can
    // short-circuit via the dedupe guard in
    // `handleLoadTopicSuggestionExplanation`.
    explanationRequestThreadIdRef.current = "";
    setTopicSuggestionExplanationOpen(false);
    setTopicSuggestionExplanationLoading(false);
    setTopicSuggestionExplanationError("");
  }, [activeMessage?.threadId, activeAccountId]);

  useEffect(() => {
    // Thread ids are only unique within an account. On account change,
    // wipe the cached explanation and its threadId so the dedupe guard
    // can't short-circuit on a coincidental thread-id match and show one
    // account's explanation under another account's thread.
    setTopicSuggestionExplanation(null);
    setTopicSuggestionExplanationThreadId("");
    // Message ids are only unique within an account, so clear per-message
    // font + zoom overrides and the selected body-panel map to prevent
    // one account's UI settings from leaking onto a coincidentally-
    // matching id in another account.
    setMessageFontScale({});
    setMessageZoom({});
    setMessageTabs({});
  }, [activeAccountId]);

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
                  threadViewMode,
                  messageFontScale,
                  setMessageFontScale,
                  messageZoom,
                  adjustMessageZoom,
                  resetMessageZoom,
                  renderMarkdownPanel,
                  messageTabs,
                  setMessageTabs
                }}
              />
            </>
          );
        })()}
    </MessageViewPane>
  );
}

const MessageViewOrchestrator = forwardRef<
  MessageViewOrchestratorHandle,
  MessageViewOrchestratorProps
>(MessageViewOrchestratorImpl);
MessageViewOrchestrator.displayName = "MessageViewOrchestrator";

export default MessageViewOrchestrator;
