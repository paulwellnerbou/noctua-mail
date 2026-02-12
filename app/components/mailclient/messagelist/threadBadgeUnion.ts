import type { Message } from "@/lib/data";
import { CALENDAR_INVITE_FLAG, hasMessageFlag } from "@/lib/messageFlags";
import { shouldShowAttachmentIcon } from "../utils/messageHelpers";

export type ThreadBadgeUnion = {
  threadCategories: string[];
  threadHasFlagged: boolean;
  threadHasAttachments: boolean;
  threadHasCalendar: boolean;
};

type ThreadFlatEntry = { message: Message; depth: number };

export function getCollapsedThreadBadgeUnion(params: {
  isCollapsedThreadRoot: boolean;
  fullFlat: ThreadFlatEntry[];
}): ThreadBadgeUnion | null {
  const { isCollapsedThreadRoot, fullFlat } = params;
  if (!isCollapsedThreadRoot) return null;

  const categories = new Set<string>();
  let hasFlagged = false;
  let hasAttachments = false;
  let hasCalendar = false;

  fullFlat.forEach(({ message }) => {
    if (message.category) categories.add(message.category);
    if (message.flagged) hasFlagged = true;
    if (shouldShowAttachmentIcon(message)) hasAttachments = true;
    if (hasMessageFlag(message.flags, CALENDAR_INVITE_FLAG)) hasCalendar = true;
  });

  return {
    threadCategories: Array.from(categories),
    threadHasFlagged: hasFlagged,
    threadHasAttachments: hasAttachments,
    threadHasCalendar: hasCalendar
  };
}
