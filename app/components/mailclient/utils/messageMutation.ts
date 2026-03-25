/**
 * Shared helpers for message mutation operations (move, delete, etc.)
 */
import type { Folder, Message } from "@/lib/data";

export type FolderTransferCountInput = {
  fromFolderId: string;
  toFolderId: string;
  unread: boolean;
};

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

export function applyFolderTransferCounts(
  folders: Folder[],
  transfers: FolderTransferCountInput[]
) {
  if (folders.length === 0 || transfers.length === 0) return folders;
  const deltas = new Map<string, { count: number; unreadCount: number }>();
  transfers.forEach((transfer) => {
    if (!transfer.fromFolderId || !transfer.toFolderId || transfer.fromFolderId === transfer.toFolderId) {
      return;
    }
    const sourceDelta = deltas.get(transfer.fromFolderId) ?? { count: 0, unreadCount: 0 };
    sourceDelta.count -= 1;
    if (transfer.unread) {
      sourceDelta.unreadCount -= 1;
    }
    deltas.set(transfer.fromFolderId, sourceDelta);

    const destinationDelta = deltas.get(transfer.toFolderId) ?? { count: 0, unreadCount: 0 };
    destinationDelta.count += 1;
    if (transfer.unread) {
      destinationDelta.unreadCount += 1;
    }
    deltas.set(transfer.toFolderId, destinationDelta);
  });
  if (deltas.size === 0) return folders;

  let changed = false;
  const nextFolders = folders.map((folder) => {
    const delta = deltas.get(folder.id);
    if (!delta) return folder;
    changed = true;
    return {
      ...folder,
      count: Math.max(0, (folder.count ?? 0) + delta.count),
      unreadCount: Math.max(0, (folder.unreadCount ?? 0) + delta.unreadCount)
    };
  });
  return changed ? nextFolders : folders;
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
