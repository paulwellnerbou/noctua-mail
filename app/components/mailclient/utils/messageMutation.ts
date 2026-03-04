/**
 * Shared helpers for message mutation operations (move, delete, etc.)
 */
import type { Message } from "@/lib/data";

type CrossFolderThreadPruneOptions = {
  searchScope: "folder" | "all";
  activeFolderId: string;
  includeThreadAcrossFoldersForList: boolean;
};

/**
 * Get a safe display subject for notification messages
 */
export function getMessageSubjectForNotice(message?: Message | null): string {
  return message?.subject?.trim() || "(no subject)";
}

export function getMessageThreadKey(message: Pick<Message, "threadId" | "messageId" | "id">) {
  return message.threadId ?? message.messageId ?? message.id;
}

export function pruneDetachedCrossFolderThreadMessages(
  messages: Message[],
  options: CrossFolderThreadPruneOptions
): Message[] {
  const { searchScope, activeFolderId, includeThreadAcrossFoldersForList } = options;
  if (
    searchScope !== "folder" ||
    !activeFolderId ||
    !includeThreadAcrossFoldersForList ||
    messages.length === 0
  ) {
    return messages;
  }

  const anchoredThreadKeys = new Set(
    messages
      .filter((message) => message.folderId === activeFolderId)
      .map((message) => getMessageThreadKey(message))
  );

  if (anchoredThreadKeys.size === 0) {
    return messages.filter((message) => message.folderId === activeFolderId);
  }

  let changed = false;
  const next = messages.filter((message) => {
    if (message.folderId === activeFolderId) return true;
    const keep = anchoredThreadKeys.has(getMessageThreadKey(message));
    if (!keep) changed = true;
    return keep;
  });
  return changed ? next : messages;
}

/**
 * Remap message reference IDs in message body and attachments
 * Used when a message is moved and gets a new ID
 */
export function remapMessageReferenceIds(
  message: Message,
  previousId: string,
  nextId: string
): Message {
  if (!previousId || !nextId || previousId === nextId) return message;
  const encodedPrevious = encodeURIComponent(previousId);
  const encodedNext = encodeURIComponent(nextId);
  const replaceMessageId = (value?: string) => {
    if (!value) return value;
    return value
      .split(`messageId=${encodedPrevious}`)
      .join(`messageId=${encodedNext}`)
      .split(`messageId=${previousId}`)
      .join(`messageId=${nextId}`);
  };
  return {
    ...message,
    body: replaceMessageId(message.body) ?? message.body,
    htmlBody: replaceMessageId(message.htmlBody),
    attachments: message.attachments?.map((attachment) => ({
      ...attachment,
      url: replaceMessageId(attachment.url)
    }))
  };
}
