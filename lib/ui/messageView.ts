import type { Message } from "@/lib/data";
import {
  AI_MODIFIED_FLAG,
  CALENDAR_INVITE_FLAG,
  TODO_FLAG,
  DONE_FLAG
} from "@/lib/messageFlags";
import { extractVisibleHtmlText, selectPreferredHtmlDocument } from "@/lib/html";

export type ImapFlagBadge = { label: string; kind: string };

export function hasHtmlContent(html?: string) {
  if (!html) return false;
  const trimmed = selectPreferredHtmlDocument(html);
  if (!trimmed || trimmed === "0") return false;
  if (/<(img|table|svg|video|iframe|canvas|object|embed)\b/i.test(trimmed)) return true;
  const textOnly = extractVisibleHtmlText(trimmed);
  return textOnly.length > 0;
}

export function hasMeaningfulHtmlText(html?: string) {
  if (!html) return false;
  const trimmed = selectPreferredHtmlDocument(html);
  if (!trimmed || trimmed === "0") return false;
  const textOnly = extractVisibleHtmlText(trimmed);
  return /[\p{L}\p{N}]/u.test(textOnly);
}

export function getImapFlagBadges(message: Message): ImapFlagBadge[] {
  const rawFlags =
    message.flags && message.flags.length > 0
      ? message.flags
      : [
          message.seen ? "\\Seen" : null,
          message.answered ? "\\Answered" : null,
          message.flagged ? "\\Flagged" : null,
          message.deleted ? "\\Deleted" : null,
          message.draft ? "\\Draft" : null,
          message.recent ? "\\Recent" : null
        ].filter(Boolean);
  const hasForwardedHeader = Boolean(message.xForwardedMessageId?.trim());
  const seen = new Set<string>();
  const badges = (rawFlags as string[])
    .map((flag) => flag.trim())
    .filter((flag) => {
      if (!flag) return false;
      const key = flag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((flag) => {
      const lower = flag.toLowerCase();
      const isForwarded = lower === "$forwarded" || lower === "forwarded";
      const isCalendarInvite = lower === CALENDAR_INVITE_FLAG;
      const isTodo = lower === TODO_FLAG.toLowerCase();
      const isDone = lower === DONE_FLAG.toLowerCase();
      const isAiModified = lower === AI_MODIFIED_FLAG.toLowerCase();
      if (lower === "\\recent" && (message.seen || message.draft)) return null;
      const label = isForwarded
        ? "Forwarded"
        : isCalendarInvite
          ? "Calendar Invite"
          : isAiModified
            ? "AI Modified"
          : isTodo
            ? "To-Do"
            : isDone
              ? "Done"
              : lower === "\\recent"
                ? "New"
                : flag.startsWith("\\")
                  ? flag.slice(1)
                  : flag;
      let kind = "custom";
      if (lower === "\\seen") kind = "seen";
      if (lower === "\\answered") kind = "answered";
      if (lower === "\\flagged") kind = "flagged";
      if (lower === "\\deleted") kind = "deleted";
      if (lower === "\\draft") kind = "draft";
      if (lower === "\\recent") kind = "new";
      if (isForwarded) kind = "forwarded";
      if (isCalendarInvite) kind = "calendar";
      if (isAiModified) kind = "ai-modified";
      if (isTodo) kind = "todo";
      if (isDone) kind = "done";
      return { label, kind };
    })
    .filter(Boolean) as ImapFlagBadge[];
  if (hasForwardedHeader && !badges.some((badge) => badge.kind === "forwarded")) {
    badges.unshift({ label: "Forwarded", kind: "forwarded" });
  }

  // Add category badge if message is categorized
  if (message.category) {
    const categoryLabels: Record<string, string> = {
      newsletter: "📰 Newsletter",
      notification: "🔔 Notification",
      transactional: "🧾 Transactional"
    };
    const label = categoryLabels[message.category] || message.category;
    badges.push({ label, kind: `category-${message.category}` });
  }

  return badges;
}
