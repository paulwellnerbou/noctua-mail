import type { CalendarEvent } from "@/lib/data";

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

/**
 * True when at least one snapshot column has a non-empty value. Used by the
 * UI to decide whether to render the snapshot card at all.
 *
 * Pure — no DB access, safe to import from client components.
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
