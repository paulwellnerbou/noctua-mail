import type { Message } from "@/lib/data";
import { CALENDAR_INVITE_FLAG } from "@/lib/messageFlags";

export type ImapFlagBadge = { label: string; kind: string };

export function hasHtmlContent(html?: string) {
  if (!html) return false;
  const trimmed = html.trim();
  if (!trimmed || trimmed === "0") return false;
  if (/<(img|table|svg|video|iframe|canvas|object|embed)\b/i.test(trimmed)) return true;
  const textOnly = trimmed
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return textOnly.length > 0;
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
      if (lower === "\\recent" && (message.seen || message.draft)) return null;
      const label = isForwarded
        ? "Forwarded"
        : isCalendarInvite
          ? "Calendar Invite"
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
      if (lower === "pinned") kind = "pinned";
      if (isForwarded) kind = "forwarded";
      if (isCalendarInvite) kind = "calendar";
      return { label, kind };
    })
    .filter(Boolean) as ImapFlagBadge[];
  if (hasForwardedHeader && !badges.some((badge) => badge.kind === "forwarded")) {
    badges.unshift({ label: "Forwarded", kind: "forwarded" });
  }
  return badges;
}
