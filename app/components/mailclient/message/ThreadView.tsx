import type { Message } from "@/lib/data";
import ThreadMessageCard from "./ThreadMessageCard";
import type { ThreadMessageCardProps } from "./ThreadMessageCard";

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
          const activeThreadId =
            activeMessage.threadId ?? activeMessage.messageId ?? activeMessage.id;
          const hasFullThread =
            activeThreadId && (threadContentById[activeThreadId]?.length ?? 0) > 0;
          const showThreadLoading =
            supportsThreads &&
            activeThreadId &&
            threadContentLoading === activeThreadId &&
            !hasFullThread;
          if (showThreadLoading) {
            return <div className="thread-loading">Loading thread…</div>;
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
        <p>Select a message to view the thread.</p>
      )}
    </>
  );
}
