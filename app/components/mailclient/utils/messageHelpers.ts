/**
 * Pure utility functions for message operations
 */
import type { Message, Folder } from "@/lib/data";
import type { MessageGroupMeta } from "../messagelist/listModel";
import {
  hasMessageFlag,
  hasTodoFlag as hasTodoFlagFromFlags,
  hasDoneFlag as hasDoneFlagFromFlags,
  CALENDAR_INVITE_FLAG,
  isMeaningfulNonInlineAttachment
} from "@/lib/messageFlags";

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

export function isFlaggedMessage(message: Message): boolean {
  return isMessageFlagged(message);
}

export function isThreadExcludedFolder(folderId: string | null | undefined, folders: Folder[]): boolean {
  if (!folderId) return false;
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return false;
  const special = (folder.specialUse ?? "").toLowerCase();
  return special === "\\trash" || special === "\\junk" || special === "\\spam";
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

export function hasCalendarFlag(message: Message) {
  return hasMessageFlag(message.flags, CALENDAR_INVITE_FLAG);
}

export function hasNonInlineAttachments(message: Message) {
  const attachments = message.attachments ?? [];
  if (attachments.length > 0) {
    return attachments.some(isMeaningfulNonInlineAttachment);
  }
  return Boolean(message.hasAttachments);
}

export function shouldShowAttachmentIcon(message: Message) {
  return hasNonInlineAttachments(message);
}
