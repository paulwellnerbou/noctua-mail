import { parseIcsInvite, type CalendarEventPreview } from "@/lib/calendar";
import { cancelCalendarEventByUid, upsertCalendarEventByUid } from "@/lib/db";

function normalizeDateList(values: number[]) {
  if (values.length === 0) return undefined;
  const next = Array.from(
    new Set(
      values
        .map((v) => Math.round(Number(v)))
        .filter((v) => Number.isFinite(v) && v > 0)
    )
  ).sort((a, b) => a - b);
  return next.length > 0 ? next : undefined;
}

type EventGroup = {
  eventUid: string;
  canceledWhole: boolean;
  base: CalendarEventPreview | null;
  addedRecurrenceDates: number[];
  addedExcludedDates: number[];
};

export async function importEmailCalendarEvents(
  accountId: string,
  messageId: string,
  icsSource: string
): Promise<void> {
  if (!icsSource?.trim()) return;
  try {
    const parsed = parseIcsInvite(icsSource);
    const method = parsed.method?.trim().toUpperCase() ?? "";
    const groupsByUid = new Map<string, EventGroup>();

    const getGroup = (uid: string): EventGroup => {
      let g = groupsByUid.get(uid);
      if (!g) {
        g = { eventUid: uid, canceledWhole: false, base: null, addedRecurrenceDates: [], addedExcludedDates: [] };
        groupsByUid.set(uid, g);
      }
      return g;
    };

    for (const event of parsed.events) {
      const uid = event.uid?.trim();
      if (!uid) continue;
      const group = getGroup(uid);
      const status = event.status?.trim().toUpperCase() ?? "";
      const cancelled = method === "CANCEL" || status === "CANCELLED";
      const recurrenceIdMs = event.recurrenceId?.getTime();
      const hasRecurrenceId = recurrenceIdMs != null && Number.isFinite(recurrenceIdMs) && recurrenceIdMs > 0;

      if (cancelled) {
        if (hasRecurrenceId) {
          group.addedExcludedDates.push(recurrenceIdMs!);
        } else {
          group.canceledWhole = true;
        }
        continue;
      }

      if (hasRecurrenceId) {
        // Rescheduled instance: exclude original, add new date
        group.addedExcludedDates.push(recurrenceIdMs!);
        const startMs = event.start?.getTime();
        if (startMs != null && Number.isFinite(startMs) && startMs > 0) {
          group.addedRecurrenceDates.push(startMs);
        }
        continue;
      }

      group.base = event;
    }

    for (const group of groupsByUid.values()) {
      if (group.canceledWhole) {
        await cancelCalendarEventByUid(accountId, group.eventUid);
        continue;
      }

      if (!group.base) {
        // Instance-only changes without a base event — update excludedDates if event already exists
        if (group.addedExcludedDates.length > 0) {
          // We don't have enough info to create a new event; skip
        }
        continue;
      }

      const base = group.base;
      const startMs = base.start?.getTime();
      if (!startMs || !Number.isFinite(startMs)) continue;

      const baseRecurrenceDates = base.recurrenceDates?.map((d) => d.getTime()) ?? [];
      const baseExcludedDates = base.excludedDates?.map((d) => d.getTime()) ?? [];

      const mergedRecurrenceDates = normalizeDateList([...baseRecurrenceDates, ...group.addedRecurrenceDates]);
      const mergedExcludedDates = normalizeDateList([...baseExcludedDates, ...group.addedExcludedDates]);

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
        // Force TENTATIVE for email-sourced events
        status: "TENTATIVE",
        sourceType: "email",
        messageId,
        rawIcs: icsSource
      });
    }
  } catch (err) {
    console.error("[emailEventImporter] Failed to import ICS events:", err);
  }
}
