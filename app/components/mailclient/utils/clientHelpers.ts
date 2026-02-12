/**
 * General client utility functions
 */

export function makeClientId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildNotificationUrl(messageId?: string | null, accountId?: string | null): string {
  const params = new URLSearchParams();
  if (typeof accountId === "string" && accountId.trim()) {
    params.set("accountId", accountId.trim());
  }
  if (typeof messageId === "string" && messageId.trim()) {
    params.set("messageId", messageId.trim());
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export function getExceptionSummary(message: string): string {
  return message.split("\n")[0]?.slice(0, 120) || "(no message)";
}

export function getExceptionDetail(message: string): string | null {
  const detail = message.trim();
  return detail || null;
}

export function extractEmails(value?: string): string[] {
  if (!value) return [];
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  return matches ?? [];
}
