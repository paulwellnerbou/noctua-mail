import React from "react";
import type { Message } from "@/lib/data";
import { Text } from "@radix-ui/themes";
import { needsMessageContentHydration } from "@/lib/ui/messageView";
import ThreadMessageCard from "./ThreadMessageCard";
import type { ThreadMessageCardProps } from "./ThreadMessageCard";
import { getVisibleThreadMessages } from "./threadViewState";
import styles from "./ThreadView.module.css";

type ThreadViewProps = {
  showComposeInline: boolean;
  activeMessage: Message | null;
  activeThread: Message[];
  supportsThreads: boolean;
  threadContentById: Record<string, Message[]>;
  threadContentLoading: string | null;
  threadContentErrorById: Record<string, string>;
  messageCardProps: Omit<ThreadMessageCardProps, "message">;
  composeDraftId: string | null;
  composeReplyMessageId: string | null;
  renderComposeInlineCard: (() => React.ReactNode) | null;
};

export default function ThreadView({
  showComposeInline,
  activeMessage,
  activeThread,
  supportsThreads,
  threadContentById,
  threadContentLoading,
  threadContentErrorById,
  messageCardProps,
  composeDraftId,
  composeReplyMessageId,
  renderComposeInlineCard
}: ThreadViewProps) {
  return (
    <>
      {activeMessage ? (
        (() => {
          const activeThreadId =
            activeMessage.threadId ?? activeMessage.messageId ?? activeMessage.id;
          const hasFullThread = Boolean(
            activeThreadId && (threadContentById[activeThreadId]?.length ?? 0) > 0
          );
          const isThreadLoading = Boolean(
            activeThreadId && threadContentLoading === activeThreadId
          );
          const activeThreadError = activeThreadId ? threadContentErrorById[activeThreadId] : "";
          const activeMessageFromThread =
            activeThread.find((item) => item.id === activeMessage.id) ?? activeMessage;
          const activeMessageBodyLoading =
            isThreadLoading && needsMessageContentHydration(activeMessageFromThread);
          const activeMessageBodyError =
            !isThreadLoading &&
            Boolean(activeThreadError) &&
            needsMessageContentHydration(activeMessageFromThread);
          // When threads are disabled, the right pane shows only the
          // selected message — `activeThread` may still contain siblings
          // (from `threadContentById` cache or threadId matches in the
          // visible list) and rendering them here surfaces them as
          // collapsed cards from the selection-collapse effect.
          const showOnlyActiveMessage =
            !supportsThreads || (isThreadLoading && !hasFullThread);
          const baseThread = showOnlyActiveMessage
            ? [activeMessageFromThread]
            : activeThread;
          const visibleThread = getVisibleThreadMessages({
            activeThread: baseThread,
            showComposeInline,
            composeDraftId
          });
          const { threadViewMode, collapsedMessages } = messageCardProps;
          return (
            <>
              {visibleThread.map((message) => {
                const isCompactCollapsed =
                  threadViewMode === "compact" && Boolean(collapsedMessages[message.id]);
                return (
                <div
                  key={message.id}
                  className={`${styles.threadItem} ${isCompactCollapsed ? styles.compactThreadItem : ""}`}
                >
                  <ThreadMessageCard
                    message={message}
                    bodyLoading={activeMessageBodyLoading && message.id === activeMessageFromThread.id}
                    bodyLoadError={
                      activeMessageBodyError && message.id === activeMessageFromThread.id
                        ? activeThreadError
                        : null
                    }
                    {...messageCardProps}
                  />
                  {composeReplyMessageId === message.id && renderComposeInlineCard?.()}
                </div>
                );
              })}
            </>
          );
        })()
      ) : showComposeInline ? null : (
        <Text size="2" color="gray" className={styles.empty}>
          Select a message to view the thread.
        </Text>
      )}
    </>
  );
}
