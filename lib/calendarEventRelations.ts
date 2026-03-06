import { collectCalendarInviteMutationGroups } from "./calendarInviteProcessing";
import {
  listCalendarEventsBySource,
  listCalendarInviteSourceMessagesByEventUid,
  updateCalendarEventMessageRelations
} from "./db";
import { getMessageSource } from "./storage";

export type MessageCandidate = {
  messageId: string;
  icsSource: string;
  dateValue: number;
};

export type CalendarEventMessageRelations = {
  /** Most recent REQUEST email that defines the whole series (base VEVENT, no RECURRENCE-ID). */
  seriesMessageId: string | null;
  /**
   * Per-occurrence message links for rescheduled occurrences visible in the calendar.
   * Key = occurrence startAtMs (as string), value = messageId of the most recent email
   * that rescheduled/updated that specific occurrence.
   */
  occurrenceMessageIds: Record<string, string>;
};

/**
 * Given a list of candidate messages (each with parsed ICS source), resolves the correct
 * message relations for a calendar event:
 * - seriesMessageId: the most recent REQUEST that has a full base event definition
 * - occurrenceMessageIds: for each rescheduled occurrence, the most recent email for it
 */
export function resolveEventMessageRelations(
  candidates: MessageCandidate[]
): CalendarEventMessageRelations {
  let seriesMessageId: string | null = null;
  let seriesDateValue = -1;
  const occurrenceMessageIds: Record<string, string> = {};
  const occurrenceDateValues: Record<string, number> = {};

  for (const c of candidates) {
    const groups = collectCalendarInviteMutationGroups(c.icsSource);
    for (const group of groups) {
      // Series-level: group has a base VEVENT without RECURRENCE-ID, method REQUEST
      if (group.baseEvent !== null) {
        if (c.dateValue > seriesDateValue) {
          seriesMessageId = c.messageId;
          seriesDateValue = c.dateValue;
        }
      }

      // Occurrence-level: rescheduled occurrences that appear in the calendar
      // (instanceOccurrences is only populated for REQUEST with RECURRENCE-ID, not CANCEL)
      for (const occ of group.instanceOccurrences) {
        const key = String(occ.startAtMs);
        if (c.dateValue > (occurrenceDateValues[key] ?? -1)) {
          occurrenceMessageIds[key] = c.messageId;
          occurrenceDateValues[key] = c.dateValue;
        }
      }
    }
  }

  return { seriesMessageId, occurrenceMessageIds };
}

/**
 * Recomputes the messageId and occurrenceMessageIds for all email-sourced calendar events
 * of an account, by re-reading and re-parsing each linked ICS message.
 *
 * Does NOT re-process invitations or change event data — only updates the message relation fields.
 */
export async function recomputeCalendarEventMessageRelations(accountId: string): Promise<{
  processed: number;
  updated: number;
  unchanged: number;
  errors: number;
}> {
  const events = await listCalendarEventsBySource(accountId, "email");
  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  for (const event of events) {
    try {
      const sourceMessages = await listCalendarInviteSourceMessagesByEventUid(
        accountId,
        event.eventUid
      );

      const candidates: MessageCandidate[] = [];
      for (const sm of sourceMessages) {
        const icsSource = await getMessageSource(accountId, sm.messageId);
        if (icsSource?.trim()) {
          candidates.push({ messageId: sm.messageId, icsSource, dateValue: sm.dateValue });
        }
      }

      const relations = resolveEventMessageRelations(candidates);
      const newMessageId = relations.seriesMessageId ?? event.messageId ?? null;
      const newOccurrenceIds =
        Object.keys(relations.occurrenceMessageIds).length > 0
          ? relations.occurrenceMessageIds
          : undefined;

      const existingOccIds = JSON.stringify(event.occurrenceMessageIds ?? {});
      const newOccIds = JSON.stringify(newOccurrenceIds ?? {});

      if (newMessageId === (event.messageId ?? null) && existingOccIds === newOccIds) {
        unchanged++;
        continue;
      }

      await updateCalendarEventMessageRelations(accountId, event.id, newMessageId, newOccurrenceIds);
      updated++;
    } catch (err) {
      console.error("[recomputeCalendarEventMessageRelations] error", {
        accountId,
        eventId: event.id,
        eventUid: event.eventUid,
        err
      });
      errors++;
    }
  }

  return { processed: events.length, updated, unchanged, errors };
}
