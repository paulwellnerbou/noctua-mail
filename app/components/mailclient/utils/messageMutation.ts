/**
 * Shared helpers for message mutation operations (move, delete, etc.)
 */
import type { Message } from "@/lib/data";

/**
 * Get a safe display subject for notification messages
 */
export function getMessageSubjectForNotice(message?: Message | null): string {
  return message?.subject?.trim() || "(no subject)";
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
