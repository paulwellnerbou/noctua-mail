import type { Message } from "@/lib/data";

export function getVisibleThreadMessages(params: {
  activeThread: Message[];
  showComposeInline: boolean;
  composeDraftId: string | null;
}) {
  const { activeThread, showComposeInline, composeDraftId } = params;
  if (!showComposeInline || !composeDraftId) {
    return activeThread;
  }
  return activeThread.filter((message) => message.id !== composeDraftId);
}

// The messages ThreadView actually renders. Inline compose placement must be
// derived from this list rather than `activeThread`: a slot beneath a message
// that is not rendered leaves the composer with nowhere to mount.
export function getRenderedThreadMessages(params: {
  activeMessage: Message | null | undefined;
  activeThread: Message[];
  supportsThreads: boolean;
  threadContentById: Record<string, Message[]>;
  threadContentLoading: string | null;
  showComposeInline: boolean;
  composeDraftId: string | null;
}) {
  const {
    activeMessage,
    activeThread,
    supportsThreads,
    threadContentById,
    threadContentLoading,
    showComposeInline,
    composeDraftId
  } = params;
  if (!activeMessage) return [];
  const activeThreadId = activeMessage.threadId ?? activeMessage.messageId ?? activeMessage.id;
  const hasFullThread = (threadContentById[activeThreadId]?.length ?? 0) > 0;
  const isThreadLoading = threadContentLoading === activeThreadId;
  // When threads are disabled, the right pane shows only the selected
  // message — `activeThread` may still contain siblings (from the
  // `threadContentById` cache or threadId matches in the visible list).
  const showOnlyActiveMessage = !supportsThreads || (isThreadLoading && !hasFullThread);
  const baseThread = showOnlyActiveMessage
    ? [activeThread.find((item) => item.id === activeMessage.id) ?? activeMessage]
    : activeThread;
  return getVisibleThreadMessages({ activeThread: baseThread, showComposeInline, composeDraftId });
}

export function getInlineComposePlacement(params: {
  activeThread: Message[];
  showComposeInline: boolean;
  composeReplyMessage: Message | null;
}) {
  const { activeThread, showComposeInline, composeReplyMessage } = params;
  const replyMessageInThread = composeReplyMessage
    ? activeThread.some((message) => message.id === composeReplyMessage.id)
    : false;

  return {
    replyMessageInThread,
    showComposeAtTop: showComposeInline && (!composeReplyMessage || !replyMessageInThread),
    composeReplyMessageId:
      showComposeInline && replyMessageInThread && composeReplyMessage
        ? composeReplyMessage.id
        : null
  };
}

export function getComposeThreadFocusMessageId(params: {
  showComposeInline: boolean;
  composeReplyMessage: Pick<Message, "id"> | null;
  activeMessage: Pick<Message, "id"> | null | undefined;
  composeDraftId: string | null;
}) {
  const { showComposeInline, composeReplyMessage, activeMessage, composeDraftId } = params;
  if (!showComposeInline) return null;
  return composeReplyMessage?.id ?? activeMessage?.id ?? composeDraftId;
}

export function doesCachedThreadCoverMessages(params: {
  activeThread: Message[];
  cachedThread?: Message[];
}) {
  const { activeThread, cachedThread } = params;
  if (activeThread.length === 0) return true;
  const cachedIds = new Set((cachedThread ?? []).map((message) => message.id));
  return activeThread.every((message) => cachedIds.has(message.id));
}
