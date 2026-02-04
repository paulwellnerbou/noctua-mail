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
  messageCardProps: Omit<ThreadMessageCardProps, "message">;
};

export default function ThreadView({
  showComposeInline,
  activeMessage,
  activeThread,
  supportsThreads,
  threadContentById,
  threadContentLoading,
  messageCardProps
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
          const hasFullThread =
            activeThreadId && (threadContentById[activeThreadId]?.length ?? 0) > 0;
          const showThreadLoading =
            supportsThreads &&
            activeThreadId &&
            threadContentLoading === activeThreadId &&
            !hasFullThread;
          const activeMessageFromThread =
            activeThread.find((item) => item.id === activeMessage.id) ?? activeMessage;
          const showMessageContentLoading =
            activeThreadId &&
            threadContentLoading === activeThreadId &&
            !showThreadLoading &&
            !hasMessageContent(activeMessageFromThread);
          if (showThreadLoading) {
            return (
              <Text size="2" color="gray" className={styles.loading}>
                Loading thread…
              </Text>
            );
          }
          if (showMessageContentLoading) {
            return (
              <Text size="2" color="gray" className={styles.loading}>
                Loading message content…
              </Text>
            );
          }
          return activeThread.map((message) => (
            <ThreadMessageCard
              key={message.id}
              message={message}
              {...messageCardProps}
            />
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
