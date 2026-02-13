import React from "react";
import type { Message } from "@/lib/data";
import { Text } from "@radix-ui/themes";
import { hasHtmlContent } from "@/lib/ui/messageView";
import ThreadMessageCard from "./ThreadMessageCard";
import type { ThreadMessageCardProps } from "./ThreadMessageCard";
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
  composeReplyMessageId,
  renderComposeInlineCard
}: ThreadViewProps) {
  return (
    <>
      {activeMessage ? (
        (() => {
          const hasMessageContent = (message?: Message | null) => {
            if (!message) return false;
            return (message.body ?? "").trim().length > 0 || hasHtmlContent(message.htmlBody);
          };
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
          const activeMessageBodyLoading = isThreadLoading && !hasMessageContent(activeMessageFromThread);
          const activeMessageBodyError =
            !isThreadLoading && Boolean(activeThreadError) && !hasMessageContent(activeMessageFromThread);
          const visibleThread =
            supportsThreads && isThreadLoading && !hasFullThread
              ? [activeMessageFromThread]
              : activeThread;
          return visibleThread.map((message) => (
            <React.Fragment key={message.id}>
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
            </React.Fragment>
          ));
        })()
      ) : showComposeInline ? null : (
        <Text size="2" color="gray" className={styles.empty}>
          Select a message to view the thread.
        </Text>
      )}
    </>
  );
}
