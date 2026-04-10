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

export function doesCachedThreadCoverMessages(params: {
  activeThread: Message[];
  cachedThread?: Message[];
}) {
  const { activeThread, cachedThread } = params;
  if (activeThread.length === 0) return true;
  const cachedIds = new Set((cachedThread ?? []).map((message) => message.id));
  return activeThread.every((message) => cachedIds.has(message.id));
}
