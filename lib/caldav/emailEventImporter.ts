import { inferCalendarInviteActionType, collectCalendarInviteMutationGroups } from "@/lib/calendarInviteProcessing";
import {
  mergeCalendarParticipation,
  resolveCalendarParticipationFromPreview
} from "@/lib/calendarParticipation";
import { resolveEmailCalendarEventStatus } from "@/lib/calendarEventStatus";
import { cancelCalendarEventByUid, upsertCalendarEventByUid } from "@/lib/db";
import { buildCalendarEventEmailSnapshotFromMessageId } from "@/lib/calendarEventEmailSnapshot";

export async function importEmailCalendarEvents(
  accountId: string,
  messageId: string,
  icsSource: string,
  accountEmail?: string | null
): Promise<void> {
  if (!icsSource?.trim()) return;
  try {
    const groups = collectCalendarInviteMutationGroups(icsSource);

    for (const group of groups) {
      if (inferCalendarInviteActionType(group) === "cancellation") {
        await cancelCalendarEventByUid(accountId, group.eventUid);
        continue;
      }

      if (!group.baseEvent) {
        // Instance-only changes without a base event — update excludedDates if event already exists
        if (group.addedExcludedDates.length > 0) {
          // We don't have enough info to create a new event; skip
        }
        continue;
      }

      const base = group.baseEvent;
      const startMs = base.start?.getTime();
      if (!startMs || !Number.isFinite(startMs)) continue;
      const participation = mergeCalendarParticipation(
        undefined,
        resolveCalendarParticipationFromPreview(base, accountEmail)
      );

      const baseRecurrenceDates = base.recurrenceDates?.map((d) => d.getTime()) ?? [];
      const baseExcludedDates = base.excludedDates?.map((d) => d.getTime()) ?? [];

      const mergedRecurrenceDates =
        group.addedRecurrenceDates.length > 0 || baseRecurrenceDates.length > 0
          ? Array.from(new Set([...baseRecurrenceDates, ...group.addedRecurrenceDates])).sort(
              (a, b) => a - b
            )
          : undefined;
      const mergedExcludedDates =
        group.addedExcludedDates.length > 0 || baseExcludedDates.length > 0
          ? Array.from(new Set([...baseExcludedDates, ...group.addedExcludedDates])).sort(
              (a, b) => a - b
            )
          : undefined;

      // Capture the source email snapshot (Topic 2) alongside the event.
      const snapshot = await buildCalendarEventEmailSnapshotFromMessageId(accountId, messageId);

      await upsertCalendarEventByUid(accountId, {
        eventUid: group.eventUid,
        summary: base.summary?.trim() || "Untitled Event",
        description: base.description?.trim() || undefined,
        location: base.location?.trim() || undefined,
        organizer: base.organizer?.trim() || undefined,
        startAtMs: startMs,
        endAtMs: base.end?.getTime() || undefined,
        allDay: base.allDay,
        startTimezone: base.startTimezone || undefined,
        endTimezone: base.endTimezone || undefined,
        recurrenceRule: base.recurrenceRule?.trim() || undefined,
        recurrenceDates: mergedRecurrenceDates,
        excludedDates: mergedExcludedDates,
        status: resolveEmailCalendarEventStatus(base.status),
        attendees: participation.attendees,
        myPartstat: participation.myPartstat,
        myPartstatUpdatedAtMs: participation.myPartstatUpdatedAtMs,
        myAttendeeEmail: participation.myAttendeeEmail,
        replyRequested: participation.replyRequested,
        sourceType: "email",
        messageId,
        rawIcs: icsSource,
        ...(snapshot ?? {})
      });
    }
  } catch (err) {
    console.error("[emailEventImporter] Failed to import ICS events:", err);
  }
}
