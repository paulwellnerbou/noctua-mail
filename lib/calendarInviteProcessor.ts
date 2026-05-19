import type { CalendarEvent } from "@/lib/data";
import {
  cancelCalendarEventByUid,
  cancelCalendarRemindersByEventUid,
  ensureCalendarReminder,
  getCalendarEventByUid,
  listCalendarInviteSourceMessagesByEventUid,
  markMessageCalendarInviteStatesProcessed,
  markMessageCalendarInviteStatesUnprocessed,
  rescheduleCalendarRemindersByEventUid,
  upsertCalendarEventByUid,
  upsertMessageCalendarInviteStates
} from "@/lib/db";
import { buildCalendarEventEmailSnapshotFromMessageId } from "@/lib/calendarEventEmailSnapshot.server";
import {
  collectCalendarInviteMutationGroups,
  inferCalendarInviteActionType,
  inferCalendarInviteMessageActionType,
  type CalendarInviteActionType,
  type CalendarInviteMutationGroup,
  type CalendarInviteUnprocessedReason
} from "@/lib/calendarInviteProcessing";
import { parseIcsInvite } from "@/lib/calendar";
import {
  mergeCalendarParticipation,
  resolveCalendarParticipationFromPreview
} from "@/lib/calendarParticipation";
import { resolveEmailCalendarEventStatus } from "@/lib/calendarEventStatus";
import { deriveInviteDeckEventBounds } from "@/lib/inviteDeckEventBounds";
import {
  buildCalendarEventSnapshotFromParsed,
  CALENDAR_EVENT_SNAPSHOT_VERSION,
  serializeCalendarEventSnapshot
} from "@/lib/calendarEventSnapshot";
import { getMessageSource } from "@/lib/storage";
import { extractIcsSourceFromEmailSource } from "@/lib/mail/attachmentFromSource";
import { reconcileSeriesAnchorSiblings } from "@/lib/calendarSeriesReanchor";

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

/**
 * For each incoming occurrence override, finds any existing override entries
 * for the same RECURRENCE-ID at a different startAtMs — those are stale
 * because the new invite supersedes them. Returns the set of stale startAtMs
 * keys (as numbers) so callers can evict matching entries from
 * `recurrenceDates`, `occurrenceMessageIds`, `occurrenceSnapshots`, and
 * `occurrenceRecurrenceIds`.
 */
function collectSupersededOccurrenceStarts(
  group: CalendarInviteMutationGroup,
  existingEvent?: CalendarEvent | null
): Set<number> {
  const existingOccurrenceRecurrenceIds = existingEvent?.occurrenceRecurrenceIds ?? {};
  const supersededStarts = new Set<number>();
  for (const occ of group.instanceOccurrences) {
    for (const [priorStartKey, priorRecurrenceId] of Object.entries(existingOccurrenceRecurrenceIds)) {
      if (priorRecurrenceId !== occ.recurrenceIdAtMs) continue;
      if (priorStartKey === String(occ.startAtMs)) continue;
      const priorStart = Number(priorStartKey);
      if (Number.isFinite(priorStart) && priorStart > 0) {
        supersededStarts.add(priorStart);
      }
    }
  }
  return supersededStarts;
}

function buildMergedCalendarEventFields(
  group: CalendarInviteMutationGroup,
  messageId: string,
  icsSource: string,
  existingEvent?: CalendarEvent | null,
  accountEmail?: string | null
): Omit<CalendarEvent, "id" | "accountId" | "createdAtMs" | "updatedAtMs" | "deletedAtMs"> | null {
  const base = group.baseEvent;
  const startAtMs = base?.start?.getTime() ?? existingEvent?.startAtMs ?? Number.NaN;
  if (!Number.isFinite(startAtMs) || startAtMs <= 0) return null;
  const participation = mergeCalendarParticipation(
    existingEvent,
    resolveCalendarParticipationFromPreview(base ?? {}, accountEmail)
  );

  const supersededStarts = collectSupersededOccurrenceStarts(group, existingEvent);

  const mergedRecurrenceDates = normalizeDateList([
    ...((existingEvent?.recurrenceDates ?? []).filter((value) => !supersededStarts.has(value))),
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
    status: resolveEmailCalendarEventStatus(base?.status, existingEvent?.status),
    attendees: participation.attendees,
    myPartstat: participation.myPartstat,
    myPartstatUpdatedAtMs: participation.myPartstatUpdatedAtMs,
    myAttendeeEmail: participation.myAttendeeEmail,
    replyRequested: participation.replyRequested,
    remoteEtag: existingEvent?.remoteEtag,
    remoteHref: existingEvent?.remoteHref,
    sourceType: "email",
    // Only update messageId when the incoming ICS has a full base event (series invite/update).
    // For occurrence-only changes (e.g. single-occurrence cancellation), preserve the existing
    // event's messageId so "Open email" continues to point to the original series invite.
    messageId: group.baseEvent ? messageId : (existingEvent?.messageId ?? messageId),
    // Merge per-occurrence message links: add/update links for rescheduled occurrences from this ICS.
    // instanceOccurrences is only populated for REQUEST with RECURRENCE-ID (not CANCEL), so
    // these are occurrences that are actually visible in the calendar at the new start time.
    occurrenceMessageIds: (() => {
      const merged: Record<string, string> = {};
      for (const [key, value] of Object.entries(existingEvent?.occurrenceMessageIds ?? {})) {
        if (supersededStarts.has(Number(key))) continue;
        merged[key] = value;
      }
      if (group.instanceOccurrences.length > 0) {
        for (const occ of group.instanceOccurrences) {
          merged[String(occ.startAtMs)] = messageId;
        }
      }
      return Object.keys(merged).length > 0 ? merged : undefined;
    })(),
    occurrenceRecurrenceIds: (() => {
      const merged: Record<string, number> = {};
      for (const [key, value] of Object.entries(existingEvent?.occurrenceRecurrenceIds ?? {})) {
        if (supersededStarts.has(Number(key))) continue;
        merged[key] = value;
      }
      for (const occ of group.instanceOccurrences) {
        merged[String(occ.startAtMs)] = occ.recurrenceIdAtMs;
      }
      return Object.keys(merged).length > 0 ? merged : undefined;
    })(),
    rawIcs: icsSource
  };
}

async function hydrateExistingEventFromPriorInviteSource(
  accountId: string,
  messageId: string,
  eventUid: string,
  accountEmail?: string | null
) {
  const candidates = await listCalendarInviteSourceMessagesByEventUid(accountId, eventUid, {
    excludeMessageId: messageId
  });
  for (const candidate of candidates) {
    const emailSource = await getMessageSource(accountId, candidate.messageId);
    if (!emailSource?.trim()) continue;
    const icsSource = await extractIcsSourceFromEmailSource(emailSource);
    if (!icsSource?.trim()) continue;
    const parsed = parseIcsInvite(icsSource);
    if (parsed.method?.trim().toUpperCase() !== "REQUEST") continue;
    const candidateGroup = collectCalendarInviteMutationGroups(icsSource).find(
      (group) => group.eventUid.trim().toLowerCase() === eventUid.trim().toLowerCase()
    );
    if (!candidateGroup?.baseEvent) continue;
    const mergedEvent = buildMergedCalendarEventFields(
      candidateGroup,
      candidate.messageId,
      icsSource,
      null,
      accountEmail
    );
    if (!mergedEvent) continue;
    const snapshot = await buildCalendarEventEmailSnapshotFromMessageId(
      accountId,
      candidate.messageId
    );
    const saved = await upsertCalendarEventByUid(accountId, {
      ...mergedEvent,
      ...(snapshot ?? {})
    });
    // Bootstrapping a missing series row is just as much a new anchor
    // as a fresh REQUEST — cap any prior siblings that share the key.
    await reconcileSeriesAnchorSiblings(accountId, saved);
    return saved;
  }
  return null;
}

export type ProcessCalendarInviteForMessageParams = {
  accountId: string;
  messageId: string;
  icsSource: string;
  process: boolean;
  accountEmail?: string | null;
  reminderUserId?: string | null;
  processedByUserId?: string | null;
  processedAutomatically?: boolean | null;
};

export type ProcessCalendarInviteForMessageResult = {
  states: Array<{
    eventUid: string;
    actionType: CalendarInviteActionType;
    eventFirstStartAtMs?: number;
    eventLastEndAtMs?: number | null;
    processed: boolean;
    processedAtMs?: number;
    processedAutomatically?: boolean;
    unprocessedReason?: CalendarInviteUnprocessedReason;
  }>;
};

export async function processCalendarInviteForMessage({
  accountId,
  messageId,
  icsSource,
  process,
  accountEmail,
  reminderUserId,
  processedByUserId,
  processedAutomatically
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
    actionType: inferCalendarInviteMessageActionType(group),
    ...deriveInviteDeckEventBounds(group)
  }));
  // Parse the ICS once; a single message can carry several UIDs (base
  // event + recurrence overrides) and we'd otherwise re-parse the whole
  // source N times in this map.
  const parsedInvite = parseIcsInvite(icsSource);
  const inviteStatesWithSnapshots = inviteStates.map((state) => {
    const snapshot = buildCalendarEventSnapshotFromParsed(parsedInvite, state.eventUid);
    return {
      ...state,
      snapshotJson: snapshot ? serializeCalendarEventSnapshot(snapshot) : null,
      snapshotVersion: snapshot ? CALENDAR_EVENT_SNAPSHOT_VERSION : null
    };
  });
  await upsertMessageCalendarInviteStates(accountId, messageId, inviteStatesWithSnapshots);

  if (!process) {
    return {
      states: inviteStates.map((state) => ({ ...state, processed: false }))
    };
  }

  const processedEventUids: string[] = [];
  const processedStateByUid = new Map<string, boolean>();
  const unprocessedReasonByUid = new Map<string, CalendarInviteUnprocessedReason>();
  let processedAtMs: number | undefined;

  for (const group of groups) {
    let existingEvent = existingEventsByUid.get(group.eventUid) ?? null;
    const actionType = resolveInviteActionType(group, existingEvent);

    try {
      if (actionType === "cancellation") {
        await cancelCalendarEventByUid(accountId, group.eventUid);
        await cancelCalendarRemindersByEventUid(accountId, group.eventUid);
        processedEventUids.push(group.eventUid);
        processedStateByUid.set(group.eventUid, true);
        continue;
      }

      if (!existingEvent && !group.baseEvent && group.hasInstanceChanges) {
        existingEvent = await hydrateExistingEventFromPriorInviteSource(
          accountId,
          messageId,
          group.eventUid,
          accountEmail
        );
        existingEventsByUid.set(group.eventUid, existingEvent);
      }
      const missingSeriesForOccurrenceChange =
        !existingEvent && !group.baseEvent && group.hasInstanceChanges;

      const mergedEvent = buildMergedCalendarEventFields(
        group,
        messageId,
        icsSource,
        existingEvent,
        accountEmail
      );
      if (!mergedEvent) {
        processedStateByUid.set(group.eventUid, false);
        if (missingSeriesForOccurrenceChange) {
          unprocessedReasonByUid.set(group.eventUid, "event_series_not_found");
        }
        continue;
      }

      // Capture the source email snapshot (Topic 2) before upsert. Preserve
      // the existing snapshot when the email is no longer locally available
      // (processing a reprocessed invite whose original message was purged).
      const snapshot = await buildCalendarEventEmailSnapshotFromMessageId(
        accountId,
        mergedEvent.messageId ?? messageId
      );
      const snapshotFields: Partial<CalendarEvent> = snapshot ?? {
        sourceSubject: existingEvent?.sourceSubject,
        sourceFromAddr: existingEvent?.sourceFromAddr,
        sourceToAddr: existingEvent?.sourceToAddr,
        sourceCcAddr: existingEvent?.sourceCcAddr,
        sourceBccAddr: existingEvent?.sourceBccAddr,
        sourceDateMs: existingEvent?.sourceDateMs,
        sourceBodyText: existingEvent?.sourceBodyText,
        sourceBodyHtml: existingEvent?.sourceBodyHtml
      };

      // Per-occurrence snapshots (Option C): for each occurrence added or
      // replaced by this ICS, capture a snapshot from the delivering email
      // so the detail pane can show the occurrence-specific source email
      // rather than the series invite. Entries for an occurrence whose
      // RECURRENCE-ID has been re-rescheduled by this ICS are evicted to
      // mirror the cleanup applied to recurrenceDates / occurrenceMessageIds.
      const supersededOccurrenceStarts = collectSupersededOccurrenceStarts(group, existingEvent);
      const occurrenceSnapshotsUpdate: Record<
        string,
        NonNullable<CalendarEvent["occurrenceSnapshots"]>[string]
      > = {};
      for (const [key, value] of Object.entries(existingEvent?.occurrenceSnapshots ?? {})) {
        if (supersededOccurrenceStarts.has(Number(key))) continue;
        occurrenceSnapshotsUpdate[key] = value;
      }
      if (group.instanceOccurrences.length > 0) {
        const occurrenceSnapshot = await buildCalendarEventEmailSnapshotFromMessageId(
          accountId,
          messageId
        );
        if (occurrenceSnapshot) {
          for (const occ of group.instanceOccurrences) {
            occurrenceSnapshotsUpdate[String(occ.startAtMs)] = occurrenceSnapshot;
          }
        }
      }
      const occurrenceSnapshotsField =
        Object.keys(occurrenceSnapshotsUpdate).length > 0
          ? occurrenceSnapshotsUpdate
          : undefined;

      const savedEvent = await upsertCalendarEventByUid(accountId, {
        ...mergedEvent,
        ...snapshotFields,
        occurrenceSnapshots: occurrenceSnapshotsField
      });
      await reconcileSeriesAnchorSiblings(accountId, savedEvent);
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
    processedAtMs = Date.now();
    await markMessageCalendarInviteStatesProcessed(
      accountId,
      messageId,
      processedEventUids,
      {
        processedAtMs,
        processedByUserId: processedByUserId ?? reminderUserId,
        processedAutomatically
      }
    );
  }
  const eventSeriesNotFoundUids = Array.from(unprocessedReasonByUid.entries())
    .filter(([, reason]) => reason === "event_series_not_found")
    .map(([eventUid]) => eventUid);
  if (eventSeriesNotFoundUids.length > 0) {
    await markMessageCalendarInviteStatesUnprocessed(
      accountId,
      messageId,
      eventSeriesNotFoundUids,
      "event_series_not_found"
    );
  }

  return {
    states: inviteStates.map((state) => {
      const processed = processedStateByUid.get(state.eventUid) ?? false;
      return {
        ...state,
        processed,
        ...(processed && typeof processedAtMs === "number" ? { processedAtMs } : {}),
        ...(processed && typeof processedAutomatically === "boolean"
          ? { processedAutomatically }
          : {}),
        ...(!processed && unprocessedReasonByUid.has(state.eventUid)
          ? { unprocessedReason: unprocessedReasonByUid.get(state.eventUid) }
          : {})
      };
    })
  };
}

export type ProcessStandaloneCalendarInviteParams = {
  accountId: string;
  icsSource: string;
  accountEmail?: string | null;
};

export type ProcessStandaloneCalendarInviteFailure = {
  eventUid: string;
  message: string;
};

export type ProcessStandaloneCalendarInviteImport = {
  eventUid: string;
  /** "upsert" for new/updated events; "cancellation" for a CANCEL that hit a known UID. */
  action: "upsert" | "cancellation";
  /** Event summary at the moment of import. Empty for cancellations of rows we already removed. */
  summary?: string;
  /** Start time of the event (ms). Cancellations may not have one if the row was deleted. */
  startAtMs?: number;
  allDay?: boolean;
};

export type ProcessStandaloneCalendarInviteResult = {
  /** UIDs that were upserted, cancelled, or whose cancellation affected an existing row. */
  eventUids: string[];
  /** Detailed metadata for each imported event so callers can build user-facing messages. */
  imports: ProcessStandaloneCalendarInviteImport[];
  /** Per-group errors that were caught while processing. */
  failures: ProcessStandaloneCalendarInviteFailure[];
};

/**
 * Imports an ICS source that did not arrive as an email attachment — e.g. a
 * .ics file opened through the PWA File Handling API. Mirrors the upsert
 * portion of `processCalendarInviteForMessage` but skips everything that
 * requires a backing message (per-message invite states, email snapshots,
 * automatic reminders tied to a message).
 *
 * Per-group failures are caught and returned in `failures` so callers can
 * surface partial successes rather than rolling back the whole batch.
 */
export async function processStandaloneCalendarInvite({
  accountId,
  icsSource,
  accountEmail
}: ProcessStandaloneCalendarInviteParams): Promise<ProcessStandaloneCalendarInviteResult> {
  if (!icsSource.trim()) return { eventUids: [], imports: [], failures: [] };
  const groups = collectCalendarInviteMutationGroups(icsSource);
  if (groups.length === 0) return { eventUids: [], imports: [], failures: [] };

  const eventUids: string[] = [];
  const imports: ProcessStandaloneCalendarInviteImport[] = [];
  const failures: ProcessStandaloneCalendarInviteFailure[] = [];
  for (const group of groups) {
    // Wrap the entire per-group flow — including the initial existing-event
    // lookup — in try/catch. Without this, a DB hiccup on lookup would
    // throw out of the whole function and the caller would lose any
    // already-imported events / partial-failure detail. We resolve
    // actionType lazily so the catch block can still tag the failure with
    // whatever we know about this group.
    let actionType: CalendarInviteActionType | "unknown" = "unknown";
    try {
      const existingEvent = await getCalendarEventByUid(accountId, group.eventUid);
      actionType = resolveInviteActionType(group, existingEvent);

      if (actionType === "cancellation") {
        // A CANCEL for a UID we never saw is a no-op — don't pretend we
        // imported it (the API would otherwise return success and the UI
        // would show "Calendar updated" with nothing actually changed).
        if (!existingEvent) continue;
        await cancelCalendarEventByUid(accountId, group.eventUid);
        // The row is gone; mark this UID as imported now so a follow-up
        // reminder-cancel failure can't downgrade the cancellation to a
        // "failed" status that would leave the UI showing a stale event.
        eventUids.push(group.eventUid);
        imports.push({
          eventUid: group.eventUid,
          action: "cancellation",
          summary: existingEvent.summary,
          startAtMs: existingEvent.startAtMs,
          allDay: existingEvent.allDay
        });
        try {
          await cancelCalendarRemindersByEventUid(accountId, group.eventUid);
        } catch (error) {
          // Surface but don't undo the cancellation.
          failures.push({
            eventUid: group.eventUid,
            message: error instanceof Error ? error.message : "Reminder cleanup failed"
          });
        }
        continue;
      }

      const mergedEvent = buildMergedCalendarEventFields(group, "", icsSource, existingEvent, accountEmail);
      if (!mergedEvent) continue;

      // When an incoming ICS reschedules an occurrence we already had at a
      // different start time, the prior start key is stale. Mirror the
      // email-attachment path's eviction so per-occurrence snapshots /
      // messageIds for those superseded starts don't linger.
      const supersededStarts = collectSupersededOccurrenceStarts(group, existingEvent);

      const preservedOccurrenceSnapshots = (() => {
        if (!existingEvent?.occurrenceSnapshots) return undefined;
        const next: Record<string, NonNullable<CalendarEvent["occurrenceSnapshots"]>[string]> = {};
        for (const [key, value] of Object.entries(existingEvent.occurrenceSnapshots)) {
          if (supersededStarts.has(Number(key))) continue;
          next[key] = value;
        }
        return Object.keys(next).length > 0 ? next : undefined;
      })();

      // `upsertCalendarEventByUid` performs an INSERT OR REPLACE — it does
      // not merge with the existing row. `buildMergedCalendarEventFields`
      // only carries forward a small subset of the existing event's fields
      // (recurrence/excluded dates, remote*, attendees, etc.), so we have
      // to splice in the rest ourselves or risk wiping them. Layer order:
      //   1. existing row values (preserve what we don't touch)
      //   2. merged ICS fields (the new data)
      //   3. our sanitizations (drop placeholder messageIds, set sourceType)
      const sanitized = {
        // calendarId / source* snapshot / occurrenceSnapshots come straight
        // from the existing row — none of these are derivable from the ICS.
        calendarId: existingEvent?.calendarId,
        sourceSubject: existingEvent?.sourceSubject,
        sourceFromAddr: existingEvent?.sourceFromAddr,
        sourceToAddr: existingEvent?.sourceToAddr,
        sourceCcAddr: existingEvent?.sourceCcAddr,
        sourceBccAddr: existingEvent?.sourceBccAddr,
        sourceDateMs: existingEvent?.sourceDateMs,
        sourceBodyText: existingEvent?.sourceBodyText,
        sourceBodyHtml: existingEvent?.sourceBodyHtml,
        occurrenceSnapshots: preservedOccurrenceSnapshots,
        ...mergedEvent,
        // buildMergedCalendarEventFields stamps the messageId we passed
        // ("") onto messageId / occurrenceMessageIds. We don't have a
        // source message, so preserve whatever the existing row had instead
        // of overwriting with empty strings.
        messageId: mergedEvent.messageId?.trim() ? mergedEvent.messageId : existingEvent?.messageId,
        occurrenceMessageIds: (() => {
          // Start with what buildMergedCalendarEventFields produced (which
          // already evicts superseded RECURRENCE-ID starts), then bring
          // forward any existing links the new ICS didn't touch — except
          // for the same superseded keys.
          const merged: Record<string, string> = {};
          for (const [key, value] of Object.entries(mergedEvent.occurrenceMessageIds ?? {})) {
            if (value && value.trim()) merged[key] = value;
          }
          for (const [key, value] of Object.entries(existingEvent?.occurrenceMessageIds ?? {})) {
            if (supersededStarts.has(Number(key))) continue;
            if (!(key in merged) && value) merged[key] = value;
          }
          return Object.keys(merged).length > 0 ? merged : undefined;
        })(),
        sourceType: existingEvent?.sourceType ?? "local"
      };

      const savedEvent = await upsertCalendarEventByUid(accountId, sanitized);
      // Mark the import successful as soon as the row is written. Any
      // follow-up failure (reconcile / reminder reschedule) is surfaced as
      // a separate per-group failure entry rather than a full rollback,
      // because the calendar row is already in place and the UI needs to
      // refresh to show it.
      eventUids.push(savedEvent.eventUid);
      imports.push({
        eventUid: savedEvent.eventUid,
        action: "upsert",
        summary: savedEvent.summary,
        startAtMs: savedEvent.startAtMs,
        allDay: savedEvent.allDay
      });
      try {
        await reconcileSeriesAnchorSiblings(accountId, savedEvent);
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
          messageId: savedEvent.messageId ?? ""
        });
      } catch (error) {
        failures.push({
          eventUid: group.eventUid,
          message: error instanceof Error ? error.message : "Reminder reschedule failed"
        });
      }
    } catch (error) {
      console.error("[calendarInviteProcessor] failed to import standalone invite", {
        accountId,
        eventUid: group.eventUid,
        actionType,
        error
      });
      failures.push({
        eventUid: group.eventUid,
        message: error instanceof Error ? error.message : "Import failed"
      });
    }
  }
  return { eventUids, imports, failures };
}
