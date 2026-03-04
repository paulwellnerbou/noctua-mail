export const DETACHED_MESSAGE_DELETE_EVENT_STORAGE_KEY =
  "noctua:detached-message-delete";

export type DetachedMessageDeleteEvent = {
  accountId: string;
  action: "deleted" | "moved";
  previousMessageId: string;
  messageId: string;
  trashFolderId?: string | null;
  occurredAtMs: number;
};

export function notifyDetachedMessageDeleted(
  event: Omit<DetachedMessageDeleteEvent, "occurredAtMs">
) {
  if (typeof window === "undefined") return;
  const payload: DetachedMessageDeleteEvent = {
    ...event,
    occurredAtMs: Date.now()
  };
  try {
    window.localStorage.setItem(
      DETACHED_MESSAGE_DELETE_EVENT_STORAGE_KEY,
      JSON.stringify(payload)
    );
    window.localStorage.removeItem(DETACHED_MESSAGE_DELETE_EVENT_STORAGE_KEY);
  } catch {
    // Ignore storage failures; the popup can still close after a successful delete.
  }
}

export function parseDetachedMessageDeleteEvent(
  rawValue: string | null
): DetachedMessageDeleteEvent | null {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as Partial<DetachedMessageDeleteEvent> | null;
    if (!parsed?.accountId || !parsed.previousMessageId || !parsed.messageId) {
      return null;
    }
    if (parsed.action !== "deleted" && parsed.action !== "moved") {
      return null;
    }
    return {
      accountId: parsed.accountId,
      action: parsed.action,
      previousMessageId: parsed.previousMessageId,
      messageId: parsed.messageId,
      trashFolderId:
        typeof parsed.trashFolderId === "string" || parsed.trashFolderId === null
          ? parsed.trashFolderId
          : undefined,
      occurredAtMs:
        typeof parsed.occurredAtMs === "number" && Number.isFinite(parsed.occurredAtMs)
          ? parsed.occurredAtMs
          : Date.now()
    };
  } catch {
    return null;
  }
}
