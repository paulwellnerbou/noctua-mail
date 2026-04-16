import { getMessageById } from "@/lib/db";
import type { CalendarEventEmailSnapshot } from "@/lib/calendarEventEmailSnapshot";

function toOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") return undefined;
  return value;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value)) return undefined;
  return value;
}

/**
 * Resolve the email snapshot for a message by id. If the message cannot be
 * located (already deleted, wrong account, etc.) this returns `null`; the
 * caller should then leave the snapshot columns null on the event row.
 *
 * Server-only — touches the account DB via `getMessageById`.
 */
export async function buildCalendarEventEmailSnapshotFromMessageId(
  accountId: string,
  messageId: string
): Promise<CalendarEventEmailSnapshot | null> {
  const trimmed = messageId?.trim();
  if (!accountId || !trimmed) return null;

  const message = await getMessageById(accountId, trimmed);
  if (!message) return null;

  return {
    sourceSubject: toOptionalString(message.subject),
    sourceFromAddr: toOptionalString(message.from),
    sourceToAddr: toOptionalString(message.to),
    sourceCcAddr: toOptionalString(message.cc),
    sourceBccAddr: toOptionalString(message.bcc),
    sourceDateMs: toOptionalNumber(message.dateValue),
    sourceBodyText: toOptionalString(message.body),
    sourceBodyHtml: toOptionalString(message.htmlBody)
  };
}
