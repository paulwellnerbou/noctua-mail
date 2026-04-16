import type { CalendarEvent } from "@/lib/data";
import { getMessageById } from "@/lib/db";

/**
 * The subset of CalendarEvent fields that snapshot the originating email
 * (Topic 2, Calendar-Improvements.md). Captured at event creation time and
 * persisted on the `calendar_events` row itself so it survives deletion of
 * the source message.
 */
export type CalendarEventEmailSnapshot = Pick<
  CalendarEvent,
  | "sourceSubject"
  | "sourceFromAddr"
  | "sourceToAddr"
  | "sourceCcAddr"
  | "sourceBccAddr"
  | "sourceDateMs"
  | "sourceBodyText"
  | "sourceBodyHtml"
>;

/**
 * Empty snapshot helper — useful when the caller knows there's no source
 * email (e.g. manual event creation) and wants to explicitly clear the
 * columns.
 */
export const EMPTY_CALENDAR_EVENT_EMAIL_SNAPSHOT: Readonly<CalendarEventEmailSnapshot> =
  Object.freeze({
    sourceSubject: undefined,
    sourceFromAddr: undefined,
    sourceToAddr: undefined,
    sourceCcAddr: undefined,
    sourceBccAddr: undefined,
    sourceDateMs: undefined,
    sourceBodyText: undefined,
    sourceBodyHtml: undefined
  });

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

/**
 * True when at least one snapshot column has a non-empty value. Used by the
 * UI to decide whether to render the snapshot card at all.
 */
export function hasCalendarEventEmailSnapshot(
  event: Pick<
    CalendarEvent,
    | "sourceSubject"
    | "sourceFromAddr"
    | "sourceToAddr"
    | "sourceCcAddr"
    | "sourceBccAddr"
    | "sourceDateMs"
    | "sourceBodyText"
    | "sourceBodyHtml"
  >
): boolean {
  return Boolean(
    (event.sourceSubject && event.sourceSubject.trim()) ||
      (event.sourceFromAddr && event.sourceFromAddr.trim()) ||
      (event.sourceToAddr && event.sourceToAddr.trim()) ||
      (event.sourceCcAddr && event.sourceCcAddr.trim()) ||
      (event.sourceBccAddr && event.sourceBccAddr.trim()) ||
      typeof event.sourceDateMs === "number" ||
      (event.sourceBodyText && event.sourceBodyText.trim()) ||
      (event.sourceBodyHtml && event.sourceBodyHtml.trim())
  );
}
