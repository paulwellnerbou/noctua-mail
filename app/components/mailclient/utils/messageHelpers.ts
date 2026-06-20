/**
 * Pure utility functions for message operations
 */
import type { Message, Topic } from "@/lib/data";
import type { MessageGroupMeta } from "../messagelist/listModel";
import {
  hasMessageFlag,
  hasTodoFlag as hasTodoFlagFromFlags,
  hasDoneFlag as hasDoneFlagFromFlags,
  hasAiModifiedFlag as hasAiModifiedFlagFromFlags,
  CALENDAR_INVITE_FLAG,
  isMeaningfulVisibleAttachment
} from "@/lib/messageFlags";

/**
 * Builds the in-place "sent" representation of a draft that was just sent
 * from the message list. The row keeps its id and threadId so the list/thread
 * row transitions seamlessly (draft → sent) instead of being removed and
 * re-added a few seconds later when the Sent-folder sync lands. A draft and
 * its Sent copy share the same Message-Id-derived row id, so the background
 * sync upserts the authoritative message onto this very row.
 *
 * The date is intentionally left untouched: the Sent copy is relayed from the
 * draft's stored MIME, so its `Date:` header — and thus the synced row's date
 * — matches the draft's, and overriding it here would only cause a transient
 * re-sort that the sync would then undo.
 */
export function buildSentMessageFromDraft(
  draft: Message,
  options: {
    sentFolderId: string;
    sentMailboxPath?: string;
    sentMessageUid?: number | null;
  }
): Message {
  const flags = (draft.flags ?? []).filter((flag) => flag.toLowerCase() !== "\\draft");
  if (!flags.some((flag) => flag.toLowerCase() === "\\seen")) {
    flags.push("\\Seen");
  }
  return {
    ...draft,
    folderId: options.sentFolderId,
    mailboxPath: options.sentMailboxPath ?? draft.mailboxPath,
    imapUid: typeof options.sentMessageUid === "number" ? options.sentMessageUid : undefined,
    flags,
    draft: false,
    seen: true,
    unread: false,
    recent: false,
    draftInvite: null
  };
}

export function computeGroupMeta(items: Message[]): MessageGroupMeta[] {
  const counts = new Map<string, number>();
  items.forEach((msg) => {
    const key = msg.groupKey ?? "Other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return Array.from(counts.entries()).map(([key, count]) => ({
    key,
    label: key,
    count
  }));
}

/**
 * Adjust group-meta counts after messages are removed from the local list
 * (delete, move out of view). Without this, the server-reported per-group
 * total stays stale and the row label flips from "5" to "4 / 5" — making
 * a fully loaded group look partially loaded.
 */
export function decrementGroupMetaForMessages(
  meta: MessageGroupMeta[],
  removed: Message[]
): MessageGroupMeta[] {
  if (removed.length === 0) return meta;
  const decrementByKey = new Map<string, number>();
  removed.forEach((message) => {
    const key = message.groupKey ?? "Other";
    decrementByKey.set(key, (decrementByKey.get(key) ?? 0) + 1);
  });
  let changed = false;
  const next: MessageGroupMeta[] = [];
  meta.forEach((group) => {
    const dec = decrementByKey.get(group.key) ?? 0;
    if (dec === 0) {
      next.push(group);
      return;
    }
    changed = true;
    const nextCount = Math.max(0, group.count - dec);
    if (nextCount === 0) return;
    next.push({ ...group, count: nextCount });
  });
  return changed ? next : meta;
}

export function isFlaggedMessage(message: Message): boolean {
  return isMessageFlagged(message);
}

export function getThreadMessages(items: Message[], threadId: string, accountId: string) {
  return items.filter((message) => message.threadId === threadId && message.accountId === accountId);
}

export function applyFlagsToMessage(message: Message, flags: string[]): Message {
  const seen = hasMessageFlag(flags, "\\Seen");
  return {
    ...message,
    flags,
    seen,
    answered: hasMessageFlag(flags, "\\Answered"),
    flagged: hasMessageFlag(flags, "\\Flagged"),
    deleted: hasMessageFlag(flags, "\\Deleted"),
    draft: hasMessageFlag(flags, "\\Draft"),
    recent: hasMessageFlag(flags, "\\Recent"),
    unread: !seen
  };
}

export function isMessageFlagged(message: Message) {
  return Boolean(message.flagged) || hasMessageFlag(message.flags, "\\Flagged");
}

export function hasTodoFlag(message: Message) {
  return hasTodoFlagFromFlags(message.flags);
}

export function hasDoneFlag(message: Message) {
  return hasDoneFlagFromFlags(message.flags);
}

export function hasAiModifiedFlag(message: Message) {
  return hasAiModifiedFlagFromFlags(message.flags);
}

export function hasCalendarFlag(message: Message) {
  return hasMessageFlag(message.flags, CALENDAR_INVITE_FLAG);
}

export function hasNonInlineAttachments(message: Message) {
  const attachments = message.attachments ?? [];
  if (attachments.length > 0) {
    return attachments.some((attachment) => isMeaningfulVisibleAttachment(attachment, message.htmlBody));
  }
  return Boolean(message.hasAttachments);
}

export function shouldShowAttachmentIcon(message: Message) {
  return hasNonInlineAttachments(message);
}

/**
 * Client-side heuristic for whether a draft has any addressable recipient
 * across To/Cc/Bcc. Used to gate the Send action in the UI; the server
 * runs an authoritative parse via `draftHasSendableRecipients` before relay.
 */
export function hasSendableRecipients(message: Message): boolean {
  return Boolean(message.to?.trim() || message.cc?.trim() || message.bcc?.trim());
}

export function hasAssignedTopics(topics?: Topic[] | null) {
  if (!Array.isArray(topics) || topics.length === 0) return false;
  return topics.some((topic) => typeof topic?.id === "string" && topic.id.trim().length > 0);
}

export type UnsubscribeCapability = "one-click" | "browser" | "mailto" | null;

export function getUnsubscribeCapability(message: Message): UnsubscribeCapability {
  if (!message.listUnsubscribe) return null;

  // Parse HTTP header format string
  const lines = message.listUnsubscribe.split("\n");
  let unsubscribeValue = "";
  let hasPostHeader = false;

  for (const line of lines) {
    if (line.startsWith("List-Unsubscribe:")) {
      unsubscribeValue = line.substring("List-Unsubscribe:".length).trim();
    } else if (line.startsWith("List-Unsubscribe-Post:")) {
      hasPostHeader = line.toLowerCase().includes("one-click");
    }
  }

  const hasHttpsUrl = /<https?:\/\/[^>]+>/.test(unsubscribeValue);
  const hasMailto = /<mailto:[^>]+>/.test(unsubscribeValue);

  if (hasPostHeader && hasHttpsUrl) return "one-click";
  if (hasHttpsUrl) return "browser";
  if (hasMailto) return "mailto";
  return null;
}

export type InReplyToRef = {
  refId: string;
  target: Message;
  isForward: boolean;
};

/**
 * Resolves the "In Reply To" reference for a message.
 * Prefers xForwardedMessageId, then inReplyTo, then the last entry in references.
 * Returns null if no refId is found or if the target message is not in the map.
 */
export function resolveInReplyToRef(
  message: Message,
  messageByMessageId: Map<string, Message>
): InReplyToRef | null {
  const refId =
    message.xForwardedMessageId ??
    message.inReplyTo ??
    (message.references && message.references.length > 0
      ? message.references[message.references.length - 1]
      : undefined);
  if (!refId) return null;
  const target = messageByMessageId.get(refId);
  if (!target) return null;
  return { refId, target, isForward: Boolean(message.xForwardedMessageId) };
}

