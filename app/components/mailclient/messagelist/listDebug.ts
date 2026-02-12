import type { Message } from "@/lib/data";

export const LIST_DEBUG_PREFIX = "[noctua][list-debug]";

export function summarizeMessageForListDebug(message: Message | null | undefined) {
  if (!message) return null;
  return {
    id: message.id,
    messageId: message.messageId ?? null,
    accountId: message.accountId,
    folderId: message.folderId,
    threadId: message.threadId ?? null,
    parentId: message.parentId ?? null,
    seen: Boolean(message.seen),
    unread: Boolean(message.unread ?? !message.seen),
    dateValue: message.dateValue
  };
}

function stringifyForLog(payload: unknown) {
  try {
    return JSON.stringify(payload);
  } catch (error) {
    return JSON.stringify({
      serializationError: true,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export function logListDebug(level: "info" | "warn" | "error", event: string, payload: unknown) {
  const line = `${LIST_DEBUG_PREFIX} ${event} ${stringifyForLog(payload)}`;
  if (level === "info") {
    console.info(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.error(line);
}
