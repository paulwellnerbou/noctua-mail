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
