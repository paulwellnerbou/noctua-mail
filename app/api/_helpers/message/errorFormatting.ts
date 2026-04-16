export function appendMessageIdToError(message: string, messageId?: string | null): string {
  const normalizedMessage = message.trim() || "Unexpected error";
  const normalizedMessageId = messageId?.trim();
  if (!normalizedMessageId) return normalizedMessage;
  const prefix = `[messageId: ${normalizedMessageId}]`;
  if (normalizedMessage.startsWith(prefix)) return normalizedMessage;
  if (normalizedMessage.includes(`messageId: ${normalizedMessageId}`)) return normalizedMessage;
  return `${prefix} ${normalizedMessage}`;
}
