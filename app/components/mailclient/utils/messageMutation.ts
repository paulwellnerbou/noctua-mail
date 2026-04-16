/**
 * Shared helpers for message mutation operations (move, delete, etc.)
 */
import type { Folder, Message } from "@/lib/data";
import { applyFlagsToMessage } from "./messageHelpers";

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
 * Describe a scheduled move for optimistic UI reconciliation.
 *
 * `destinationFolderId` is only used when `searchScope === "all"`, because in
 * folder scope the moved message leaves the current list (so it's removed
 * from the visible set, not rewritten in place).
 */
export type OptimisticMoveParams = {
  movedMessageId: string;
  destinationFolderId?: string | null;
  destinationMailbox?: string;
  flags?: string[];
  searchScope: "folder" | "all";
};

/**
 * Given a message that was just moved (optimistic update before the server
 * confirms), compute what it should look like in the UI:
 *
 * - In "all"-scope search with a known destination folder: return the
 *   message relocated to the destination, re-flagged, and with body refs
 *   remapped to the new id. The list row stays visible.
 * - Otherwise: return `null` — the row should disappear from the list.
 *
 * Pure; no side effects. Consumed by `useMessageMutations.reconcileMoveMutation`
 * and by the list-pruning updater in the same code path.
 */
export function computeOptimisticMovedMessage(
  message: Message,
  params: OptimisticMoveParams
): Message | null {
  const { movedMessageId, destinationFolderId, destinationMailbox, flags, searchScope } =
    params;
  if (searchScope !== "all" || !destinationFolderId) return null;
  return remapMessageReferenceIds(
    applyFlagsToMessage(
      {
        ...message,
        id: movedMessageId,
        folderId: destinationFolderId,
        mailboxPath: destinationMailbox ?? message.mailboxPath
      },
      flags ?? message.flags ?? []
    ),
    message.id,
    movedMessageId
  );
}

export type MoveViewTransition =
  | { kind: "clear" }
  | { kind: "retarget"; nextViewMessage: Message; nextActiveMessageId: string }
  | { kind: "keep" };

/**
 * Decide how the message-view pane should react when the currently-viewed
 * message is moved.
 *
 * - `clear` → the viewer must close (the moved message left the current
 *   result set, or the search scope doesn't carry it).
 * - `retarget` → the viewer stays open on the same message but at its new
 *   id (cross-folder move in "all" scope, where the id changes).
 * - `keep` → the viewer is unaffected (id didn't change; e.g. a flag-only
 *   op that happened alongside a move reconciliation).
 *
 * The caller supplies `shouldKeepInResults` so the decision stays generic:
 * it knows search-scope and current filter; the helper doesn't.
 */
export function resolveMoveViewTransition(
  viewMessage: Message | null,
  targetMessageId: string,
  moved: Message | null,
  shouldKeepInResults: (message: Message) => boolean
): MoveViewTransition {
  if (viewMessage?.id !== targetMessageId) return { kind: "keep" };
  if (!moved || !shouldKeepInResults(moved)) return { kind: "clear" };
  if (moved.id === targetMessageId) return { kind: "keep" };
  return { kind: "retarget", nextViewMessage: moved, nextActiveMessageId: moved.id };
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
