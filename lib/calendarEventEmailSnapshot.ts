import type {
  CalendarEvent,
  CalendarEventEmailSnapshotFields
} from "@/lib/data";

/**
 * The subset of CalendarEvent fields that snapshot the originating email
 * (Topic 2, Calendar-Improvements.md). Captured at event creation time and
 * persisted on the `calendar_events` row itself so it survives deletion of
 * the source message.
 */
export type CalendarEventEmailSnapshot = CalendarEventEmailSnapshotFields;

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

/**
 * Pull the series-level snapshot fields off a CalendarEvent. Used both for
 * rendering the default snapshot and as the fallback when an occurrence
 * has no dedicated snapshot.
 */
export function extractSeriesCalendarEventEmailSnapshot(
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
): CalendarEventEmailSnapshot {
  return {
    sourceSubject: event.sourceSubject,
    sourceFromAddr: event.sourceFromAddr,
    sourceToAddr: event.sourceToAddr,
    sourceCcAddr: event.sourceCcAddr,
    sourceBccAddr: event.sourceBccAddr,
    sourceDateMs: event.sourceDateMs,
    sourceBodyText: event.sourceBodyText,
    sourceBodyHtml: event.sourceBodyHtml
  };
}

/**
 * Pick the effective snapshot for the currently viewed occurrence:
 *
 * - If `occurrenceStartAtMs` is set AND the event has a matching entry in
 *   `occurrenceSnapshots`, use that per-occurrence snapshot.
 * - Otherwise fall back to the series-level snapshot on the event row.
 *
 * Mirrors how `occurrenceMessageIds` is consulted for the "Open occurrence
 * email" button, so the visible snapshot matches the same source mail.
 *
 * Pure — no DB access, safe to import from client components.
 */
export function selectCalendarEventEmailSnapshot(
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
    | "occurrenceSnapshots"
  >,
  occurrenceStartAtMs?: number
): CalendarEventEmailSnapshot {
  if (
    typeof occurrenceStartAtMs === "number" &&
    Number.isFinite(occurrenceStartAtMs) &&
    event.occurrenceSnapshots
  ) {
    const perOccurrence = event.occurrenceSnapshots[String(occurrenceStartAtMs)];
    if (perOccurrence && hasCalendarEventEmailSnapshot(perOccurrence)) {
      return perOccurrence;
    }
  }
  return extractSeriesCalendarEventEmailSnapshot(event);
}
