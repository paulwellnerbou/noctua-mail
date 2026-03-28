import type { Message } from "@/lib/data";
import { preserveLocalOnlyMessageFlags } from "@/lib/messageFlags";

export function mergeLocalOnlyMessageState(
  next: Message,
  existing?: Message | null
): Message {
  if (!existing) return next;

  const mergedFlags = Array.isArray(next.flags)
    ? preserveLocalOnlyMessageFlags(next.flags, existing.flags)
    : (existing.flags ?? next.flags);

  return {
    ...next,
    flags: mergedFlags,
    xComposeFormat: next.xComposeFormat ?? existing.xComposeFormat,
    quotedHtmlEdited:
      typeof next.quotedHtmlEdited === "boolean"
        ? next.quotedHtmlEdited
        : existing.quotedHtmlEdited,
    draftInvite: next.draftInvite ?? existing.draftInvite,
    topics: next.topics ?? existing.topics,
    topicSuggestions: next.topicSuggestions ?? existing.topicSuggestions
  };
}
