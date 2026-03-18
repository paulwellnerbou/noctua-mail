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
