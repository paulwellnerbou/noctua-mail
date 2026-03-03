import type { CalendarEvent } from "@/lib/data";
import {
  cancelCalendarEventByUid,
  cancelCalendarRemindersByEventUid,
  ensureCalendarReminder,
  getCalendarEventByUid,
  markMessageCalendarInviteStatesProcessed,
  rescheduleCalendarRemindersByEventUid,
  upsertCalendarEventByUid,
  upsertMessageCalendarInviteStates
} from "@/lib/db";
import {
  collectCalendarInviteMutationGroups,
  inferCalendarInviteActionType,
  type CalendarInviteActionType,
  type CalendarInviteMutationGroup
} from "@/lib/calendarInviteProcessing";

const DEFAULT_AUTOMATIC_REMINDER = {
  leadMinutes: 15,
  leadLabel: "15 minutes before"
} as const;

function normalizeDateList(values: number[]) {
  if (values.length === 0) return undefined;
  const next = Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.round(value))
    )
  ).sort((a, b) => a - b);
  return next.length > 0 ? next : undefined;
}

function resolveInviteActionType(group: CalendarInviteMutationGroup, existingEvent?: CalendarEvent | null) {
  return inferCalendarInviteActionType(group, { hasExistingEvent: Boolean(existingEvent) });
}

function buildMergedCalendarEventFields(
  group: CalendarInviteMutationGroup,
  messageId: string,
  icsSource: string,
  existingEvent?: CalendarEvent | null
): Omit<CalendarEvent, "id" | "accountId" | "createdAtMs" | "updatedAtMs" | "deletedAtMs"> | null {
  const base = group.baseEvent;
  const startAtMs = base?.start?.getTime() ?? existingEvent?.startAtMs ?? Number.NaN;
  if (!Number.isFinite(startAtMs) || startAtMs <= 0) return null;

  const mergedRecurrenceDates = normalizeDateList([
    ...(existingEvent?.recurrenceDates ?? []),
    ...(base?.recurrenceDates?.map((value) => value.getTime()) ?? []),
    ...group.addedRecurrenceDates
  ]);
  const mergedExcludedDates = normalizeDateList([
    ...(existingEvent?.excludedDates ?? []),
    ...(base?.excludedDates?.map((value) => value.getTime()) ?? []),
    ...group.addedExcludedDates
  ]);

  return {
    eventUid: group.eventUid,
    summary: base?.summary?.trim() || existingEvent?.summary || "Untitled Event",
    description: base?.description?.trim() || existingEvent?.description || undefined,
    location: base?.location?.trim() || existingEvent?.location || undefined,
    organizer: base?.organizer?.trim() || existingEvent?.organizer || undefined,
    startAtMs: Math.round(startAtMs),
    endAtMs:
      base?.end?.getTime() ||
      (typeof existingEvent?.endAtMs === "number" ? existingEvent.endAtMs : undefined),
    allDay: base?.allDay ?? existingEvent?.allDay ?? false,
    startTimezone: base?.startTimezone || existingEvent?.startTimezone || undefined,
    endTimezone: base?.endTimezone || existingEvent?.endTimezone || undefined,
    recurrenceRule: base?.recurrenceRule?.trim() || existingEvent?.recurrenceRule || undefined,
    recurrenceDates: mergedRecurrenceDates,
    excludedDates: mergedExcludedDates,
    status: "TENTATIVE",
    attendees: existingEvent?.attendees,
    remoteEtag: existingEvent?.remoteEtag,
    remoteHref: existingEvent?.remoteHref,
    sourceType: "email",
    messageId,
    rawIcs: icsSource
  };
}

export type ProcessCalendarInviteForMessageParams = {
  accountId: string;
  messageId: string;
  icsSource: string;
  process: boolean;
  reminderUserId?: string | null;
  processedByUserId?: string | null;
};

export type ProcessCalendarInviteForMessageResult = {
  states: Array<{
    eventUid: string;
    actionType: CalendarInviteActionType;
    processed: boolean;
  }>;
};

export async function processCalendarInviteForMessage({
  accountId,
  messageId,
  icsSource,
  process,
  reminderUserId,
  processedByUserId
}: ProcessCalendarInviteForMessageParams): Promise<ProcessCalendarInviteForMessageResult> {
  if (!icsSource.trim()) {
    return { states: [] };
  }

  const groups = collectCalendarInviteMutationGroups(icsSource);
  if (groups.length === 0) {
    return { states: [] };
  }

  const existingEventsByUid = new Map<string, CalendarEvent | null>();
  for (const group of groups) {
    existingEventsByUid.set(group.eventUid, await getCalendarEventByUid(accountId, group.eventUid));
  }

  const inviteStates = groups.map((group) => ({
    eventUid: group.eventUid,
    actionType: resolveInviteActionType(group, existingEventsByUid.get(group.eventUid))
  }));
  await upsertMessageCalendarInviteStates(accountId, messageId, inviteStates);

  if (!process) {
    return {
      states: inviteStates.map((state) => ({ ...state, processed: false }))
    };
  }

  const processedEventUids: string[] = [];
  const processedStateByUid = new Map<string, boolean>();

  for (const group of groups) {
    const existingEvent = existingEventsByUid.get(group.eventUid) ?? null;
    const actionType = resolveInviteActionType(group, existingEvent);

    try {
      if (actionType === "cancellation") {
        await cancelCalendarEventByUid(accountId, group.eventUid);
        await cancelCalendarRemindersByEventUid(accountId, group.eventUid);
        processedEventUids.push(group.eventUid);
        processedStateByUid.set(group.eventUid, true);
        continue;
      }

      const mergedEvent = buildMergedCalendarEventFields(group, messageId, icsSource, existingEvent);
      if (!mergedEvent) {
        processedStateByUid.set(group.eventUid, false);
        continue;
      }

      const savedEvent = await upsertCalendarEventByUid(accountId, mergedEvent);
      await rescheduleCalendarRemindersByEventUid(accountId, group.eventUid, {
        eventTitle: savedEvent.summary,
        eventLocation: savedEvent.location,
        eventDescription: savedEvent.description,
        startTimezone: savedEvent.startTimezone,
        recurrenceRule: savedEvent.recurrenceRule,
        recurrenceDates: savedEvent.recurrenceDates,
        excludedDates: savedEvent.excludedDates,
        eventStartAtMs: savedEvent.startAtMs,
        eventEndAtMs: savedEvent.endAtMs,
        messageId
      });
      if (typeof reminderUserId === "string" && reminderUserId.trim()) {
        await ensureCalendarReminder(accountId, reminderUserId.trim(), {
          messageId,
          eventUid: savedEvent.eventUid,
          eventTitle: savedEvent.summary,
          eventLocation: savedEvent.location,
          eventDescription: savedEvent.description,
          startTimezone: savedEvent.startTimezone,
          recurrenceRule: savedEvent.recurrenceRule,
          recurrenceDates: savedEvent.recurrenceDates,
          excludedDates: savedEvent.excludedDates,
          eventStartAtMs: savedEvent.startAtMs,
          eventEndAtMs: savedEvent.endAtMs,
          leadMinutes: DEFAULT_AUTOMATIC_REMINDER.leadMinutes,
          leadLabel: DEFAULT_AUTOMATIC_REMINDER.leadLabel
        });
      }
      processedEventUids.push(group.eventUid);
      processedStateByUid.set(group.eventUid, true);
    } catch (error) {
      console.error("[calendarInviteProcessor] failed to process invite group", {
        accountId,
        messageId,
        eventUid: group.eventUid,
        actionType,
        error
      });
      processedStateByUid.set(group.eventUid, false);
    }
  }

  if (processedEventUids.length > 0) {
    await markMessageCalendarInviteStatesProcessed(
      accountId,
      messageId,
      processedEventUids,
      processedByUserId ?? reminderUserId
    );
  }

  return {
    states: inviteStates.map((state) => ({
      ...state,
      processed: processedStateByUid.get(state.eventUid) ?? false
    }))
  };
}
