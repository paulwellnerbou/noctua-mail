import type { Message } from "@/lib/data";

type ReplyHeaderSource = Pick<Message, "messageId" | "inReplyTo" | "references">;

function trimHeaderId(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildReplyThreadHeaders(
  message?: ReplyHeaderSource | null
): { inReplyTo?: string; references?: string[] } {
  const inReplyTo = trimHeaderId(message?.messageId);
  const references = [
    ...(message?.references ?? []),
    ...(message?.inReplyTo ? [message.inReplyTo] : []),
    ...(message?.messageId ? [message.messageId] : [])
  ]
    .map((value) => trimHeaderId(value))
    .filter((value): value is string => Boolean(value));

  return {
    inReplyTo,
    references: references.length > 0 ? Array.from(new Set(references)) : undefined
  };
}
