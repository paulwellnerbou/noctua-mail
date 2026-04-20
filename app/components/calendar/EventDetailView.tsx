"use client";

import { useEffect, useState } from "react";
import { buildCalendarRecurrenceSummary, formatCalendarEventRange } from "@/lib/calendar";
import type { CalendarInviteActionType } from "@/lib/calendarInviteProcessing";
import { formatAccountDateValue } from "@/lib/dateFormatting";
import {
  buildAccountCalendarEventPath,
  buildAccountCalendarEventRespondPath,
  buildAccountCalendarParticipationPath
} from "@/lib/accountApiPaths";
import type {
  AccountDateFormat,
  CalendarEvent,
  CalendarParticipationScope,
  CalendarParticipationStatus
} from "@/lib/data";
import { formatCalendarParticipationLabel } from "@/lib/calendarParticipation";
import { formatCalendarTimeZoneShortLabel } from "@/lib/calendarTimezones";
import { selectCalendarEventEmailSnapshot } from "@/lib/calendarEventEmailSnapshot";
import { dispatchCalendarRemindersUpdatedEvent } from "@/app/components/mailclient/utils/calendarReminders";
import { dispatchCalendarEventsUpdatedEvent } from "./calendarEventsClient";
import CalendarEventEmailSnapshot from "./CalendarEventEmailSnapshot";
import EventDeleteScopeDialog from "./EventDeleteScopeDialog";
import EventDetailActions from "./EventDetailActions";
import EventDetailBadges from "./EventDetailBadges";
import EventDetailDescription from "./EventDetailDescription";
import EventDetailMeta from "./EventDetailMeta";
import EventInviteStatusRow from "./EventInviteStatusRow";
import EventReminderDialog from "./EventReminderDialog";
import EventResponseDialog from "./EventResponseDialog";
import { useEventReminderState } from "./useEventReminderState";
import styles from "./EventDetailView.module.css";

export type CalendarEventDeleteScope = "series" | "occurrence";

export type CalendarEventDeleteAction = {
  event: CalendarEvent;
  scope: CalendarEventDeleteScope;
  occurrenceStartAtMs?: number;
};

export type EventDetailViewProps = {
  accountId: string;
  eventUid?: string;
  title: string;
  startMs?: number;
  endMs?: number;
  allDay: boolean;
  startTimezone?: string;
  endTimezone?: string;
  location?: string;
  description?: string;
  organizer?: string;
  attendees?: string[];
  recurrenceRule?: string;
  recurrenceDates?: number[];
  excludedDates?: number[];
  status?: string;
  myPartstat?: CalendarParticipationStatus;
  replyRequested?: boolean;
  canRespond?: boolean;
  sourceType?: string;
  messageId?: string;
  /** Email specific to this occurrence (e.g. a reschedule or update for just this date). */
  occurrenceMessageId?: string;
  eventId?: string;
  eventSnapshot?: CalendarEvent;
  /** The canonical event start used for reminder matching (e.g. original series start for recurring events) */
  eventStartAtMs?: number;
  eventEndAtMs?: number;
  onOpenMessage?: (messageId: string) => void;
  onEventUpdated?: (event: CalendarEvent) => void;
  onEventDeleted?: (action: CalendarEventDeleteAction) => void;
  onInviteProcessed?: (
    eventUid: string,
    processedState?: {
      processedAtMs?: number;
      processedAutomatically?: boolean;
    }
  ) => void;
  responseOccurrenceLabel?: string;
  forceOccurrenceResponse?: boolean;
  dateFormat?: AccountDateFormat;
  inviteProcessing?: {
    actionType: CalendarInviteActionType;
    processed: boolean;
    processedAtMs?: number;
    processedAutomatically?: boolean;
    processing?: boolean;
    onProcess?: () => void | Promise<void>;
  };
};

function parseHttpUrl(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildOccurrenceExcludedDates(excludedDates: number[] | undefined, occurrenceStartAtMs: number) {
  return Array.from(
    new Set(
      [...(excludedDates ?? []), occurrenceStartAtMs]
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.round(value))
    )
  ).sort((left, right) => left - right);
}

function getParticipationColor(
  status?: CalendarParticipationStatus
): "green" | "red" | "orange" | "gray" {
  if (status === "ACCEPTED") return "green";
  if (status === "DECLINED") return "red";
  if (status === "TENTATIVE") return "orange";
  return "gray";
}

function isReplyChoice(status?: CalendarParticipationStatus) {
  return status === "ACCEPTED" || status === "DECLINED" || status === "TENTATIVE";
}

function getReplyActionLabel(status?: CalendarParticipationStatus) {
  if (status === "ACCEPTED") return "Accept";
  if (status === "DECLINED") return "Decline";
  if (status === "TENTATIVE") return "Mark tentative";
  return "Respond";
}

function getInviteActionLabel(actionType: CalendarInviteActionType) {
  if (actionType === "cancellation") return "Cancellation";
  if (actionType === "update") return "Update";
  return "Invitation";
}

export default function EventDetailView({
  accountId,
  eventUid,
  title,
  startMs,
  endMs,
  allDay,
  startTimezone,
  endTimezone,
  location,
  description,
  organizer,
  attendees,
  recurrenceRule,
  recurrenceDates,
  excludedDates,
  status,
  myPartstat,
  replyRequested,
  canRespond = false,
  sourceType,
  messageId,
  occurrenceMessageId,
  eventId,
  eventSnapshot,
  eventStartAtMs,
  eventEndAtMs,
  onOpenMessage,
  onEventUpdated,
  onEventDeleted,
  onInviteProcessed,
  responseOccurrenceLabel = "This occurrence",
  forceOccurrenceResponse = false,
  dateFormat,
  inviteProcessing
}: EventDetailViewProps) {
  const resolvedStartMs = startMs ?? eventStartAtMs;

  // Time formatting
  const tzLabel = startTimezone && resolvedStartMs
    ? formatCalendarTimeZoneShortLabel(startTimezone, new Date(resolvedStartMs))
    : null;

  const timeRange = resolvedStartMs
    ? formatCalendarEventRange(
        new Date(resolvedStartMs),
        endMs ? new Date(endMs) : undefined,
        {
          allDay,
          startTimeZone: startTimezone,
          endTimeZone: endTimezone
        }
      )
    : "";

  // Recurrence summary
  const recurrenceSummary = recurrenceRule && resolvedStartMs
    ? buildCalendarRecurrenceSummary({
        allDay,
        start: new Date(resolvedStartMs),
        startTimezone,
        recurrenceRule,
        recurrenceDates: (recurrenceDates ?? []).map((ms) => new Date(ms)),
        excludedDates: (excludedDates ?? []).map((ms) => new Date(ms))
      })
    : null;

  // Location URL
  const locationUrl = parseHttpUrl(location);

  const canonicalStartMs = eventStartAtMs ?? resolvedStartMs;
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);

  const {
    existingReminder,
    reminderModalOpen,
    setReminderModalOpen,
    leadOptionValue,
    setLeadOptionValue,
    savingReminder,
    deletingReminder,
    canScheduleReminder,
    handleScheduleReminder,
    handleDeleteReminder
  } = useEventReminderState({
    accountId,
    eventUid,
    title,
    location,
    description,
    messageId,
    startTimezone,
    recurrenceRule,
    recurrenceDates,
    excludedDates,
    canonicalStartMs,
    eventEndAtMs,
    dateFormat,
    onNotice: setReminderNotice
  });
  const [currentMyPartstat, setCurrentMyPartstat] = useState(myPartstat);
  const [currentParticipationScope, setCurrentParticipationScope] =
    useState<CalendarParticipationScope>("series");
  const [isRecurringParticipation, setIsRecurringParticipation] = useState(Boolean(recurrenceRule?.trim()));
  const [responseDialogOpen, setResponseDialogOpen] = useState(false);
  const [draftPartstat, setDraftPartstat] = useState<CalendarParticipationStatus>("NEEDS-ACTION");
  const [draftScope, setDraftScope] = useState<CalendarParticipationScope>("series");
  const [sendReply, setSendReply] = useState(replyRequested !== false);
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const [deletingEvent, setDeletingEvent] = useState(false);
  const [deleteScopeDialogOpen, setDeleteScopeDialogOpen] = useState(false);
  const resolvedOccurrenceStartAtMs =
    typeof resolvedStartMs === "number" && Number.isFinite(resolvedStartMs)
      ? resolvedStartMs
      : undefined;

  useEffect(() => {
    setCurrentMyPartstat(myPartstat);
    setCurrentParticipationScope(forceOccurrenceResponse ? "occurrence" : "series");
    setIsRecurringParticipation(Boolean(recurrenceRule?.trim()));
  }, [eventId, resolvedStartMs, myPartstat, recurrenceRule, forceOccurrenceResponse]);

  useEffect(() => {
    setSendReply(replyRequested !== false);
  }, [replyRequested]);

  useEffect(() => {
    if (!reminderNotice) return;
    const t = window.setTimeout(() => setReminderNotice(null), 3000);
    return () => window.clearTimeout(t);
  }, [reminderNotice]);

  useEffect(() => {
    let active = true;
    if (!accountId || !eventId || !canRespond) return;
    const loadParticipation = async () => {
      try {
        const params = new URLSearchParams({ eventId });
        if (Number.isFinite(resolvedStartMs)) {
          params.set("occurrenceStartAtMs", String(resolvedStartMs));
        }
        const res = await fetch(buildAccountCalendarParticipationPath(accountId, params), {
          cache: "no-store"
        });
        const payload = (await res.json().catch(() => null)) as
          | {
              ok?: boolean;
              participation?: {
                partstat?: CalendarParticipationStatus;
                scope?: CalendarParticipationScope;
                isRecurring?: boolean;
              };
            }
          | null;
        if (!active || !res.ok || payload?.ok !== true || !payload.participation) return;
        setCurrentMyPartstat(payload.participation.partstat);
        setCurrentParticipationScope(
          forceOccurrenceResponse
            ? "occurrence"
            : payload.participation.scope === "occurrence"
              ? "occurrence"
              : "series"
        );
        setIsRecurringParticipation(Boolean(payload.participation.isRecurring));
      } catch {
        // ignore
      }
    };
    void loadParticipation();
    return () => {
      active = false;
    };
  }, [accountId, canRespond, eventId, resolvedStartMs, forceOccurrenceResponse]);

  const canChooseOccurrenceScope =
    !forceOccurrenceResponse && isRecurringParticipation && Number.isFinite(resolvedStartMs);
  const effectiveResponseScope: CalendarParticipationScope =
    forceOccurrenceResponse && Number.isFinite(resolvedStartMs) ? "occurrence" : draftScope;
  const hasOccurrenceCancellationAction =
    forceOccurrenceResponse &&
    Boolean(inviteProcessing?.onProcess) &&
    inviteProcessing?.actionType === "cancellation";
  const currentScopeLabel = currentParticipationScope === "occurrence"
    ? responseOccurrenceLabel
    : "Whole series";
  const responseTargetLabel = `${responseOccurrenceLabel}: ${timeRange || "Selected event"}`;

  const openResponseDialog = () => {
    setDraftPartstat(
      isReplyChoice(currentMyPartstat)
        ? currentMyPartstat
        : "NEEDS-ACTION"
    );
    setDraftScope(
      forceOccurrenceResponse && Number.isFinite(resolvedStartMs)
        ? "occurrence"
        : canChooseOccurrenceScope
          ? currentParticipationScope
          : "series"
    );
    setSendReply(replyRequested !== false);
    setResponseDialogOpen(true);
  };

  const performDeleteEvent = async (scope: CalendarEventDeleteScope) => {
    if (!accountId || !eventId || !eventSnapshot) return;
    setDeletingEvent(true);
    setDeleteScopeDialogOpen(false);
    try {
      if (scope === "occurrence") {
        if (resolvedOccurrenceStartAtMs === undefined) {
          setReminderNotice("Failed to delete occurrence.");
          return;
        }
        const response = await fetch(buildAccountCalendarEventPath(accountId, eventId), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            excludedDates: buildOccurrenceExcludedDates(
              eventSnapshot.excludedDates,
              resolvedOccurrenceStartAtMs
            )
          })
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              ok?: boolean;
              event?: CalendarEvent;
              message?: string;
            }
          | null;
        if (!response.ok || payload?.ok !== true || !payload.event) {
          setReminderNotice(payload?.message ?? "Failed to delete occurrence.");
          return;
        }
        dispatchCalendarEventsUpdatedEvent();
        dispatchCalendarRemindersUpdatedEvent();
        onEventDeleted?.({
          event: eventSnapshot,
          scope,
          occurrenceStartAtMs: resolvedOccurrenceStartAtMs
        });
        return;
      }

      const params = new URLSearchParams({ soft: "true" });
      const response = await fetch(buildAccountCalendarEventPath(accountId, eventId, params), {
        method: "DELETE"
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            message?: string;
          }
        | null;
      if (!response.ok || payload?.ok !== true) {
        setReminderNotice(payload?.message ?? "Failed to delete event.");
        return;
      }
      dispatchCalendarEventsUpdatedEvent();
      dispatchCalendarRemindersUpdatedEvent();
      onEventDeleted?.({
        event: eventSnapshot,
        scope
      });
    } catch {
      setReminderNotice(scope === "occurrence" ? "Failed to delete occurrence." : "Failed to delete event.");
    } finally {
      setDeletingEvent(false);
    }
  };

  const canChooseDeleteScope =
    Boolean(eventSnapshot) &&
    Boolean(recurrenceRule?.trim()) &&
    resolvedOccurrenceStartAtMs !== undefined;

  const handleDeleteEvent = () => {
    if (canChooseDeleteScope) {
      setDeleteScopeDialogOpen(true);
      return;
    }
    void performDeleteEvent("series");
  };

  const handleRespond = async () => {
    if (!accountId || !eventId) return;
    if (!isReplyChoice(draftPartstat)) {
      setReminderNotice("Choose a response first.");
      return;
    }
    setSubmittingResponse(true);
    try {
      const res = await fetch(buildAccountCalendarEventRespondPath(accountId, eventId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partstat: draftPartstat,
          scope: effectiveResponseScope,
          sendReply,
          occurrenceStartAtMs:
            effectiveResponseScope === "occurrence" && Number.isFinite(resolvedStartMs)
              ? resolvedStartMs
              : undefined
        })
      });
      const payload = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            message?: string;
            event?: CalendarEvent;
            participation?: {
              partstat?: CalendarParticipationStatus;
              scope?: CalendarParticipationScope;
            };
            inviteProcessing?: {
              processedAtMs?: number;
              processedAutomatically?: boolean;
            };
          }
        | null;
      if (!res.ok || payload?.ok !== true || !payload.event || !payload.participation) {
        setReminderNotice(payload?.message || "Failed to update RSVP response.");
        return;
      }
      setCurrentMyPartstat(payload.participation.partstat);
      setCurrentParticipationScope(
        forceOccurrenceResponse
          ? "occurrence"
          : payload.participation.scope === "occurrence"
            ? "occurrence"
            : "series"
      );
      onEventUpdated?.(payload.event);
      if (eventUid?.trim()) {
        onInviteProcessed?.(eventUid.trim(), {
          processedAtMs:
            typeof payload.inviteProcessing?.processedAtMs === "number" &&
            Number.isFinite(payload.inviteProcessing.processedAtMs)
              ? payload.inviteProcessing.processedAtMs
              : undefined,
          processedAutomatically:
            typeof payload.inviteProcessing?.processedAutomatically === "boolean"
              ? payload.inviteProcessing.processedAutomatically
              : undefined
        });
      }
      setResponseDialogOpen(false);
      dispatchCalendarEventsUpdatedEvent();
      const savedLabel = formatCalendarParticipationLabel(payload.participation.partstat);
      const appliedLabel =
        (forceOccurrenceResponse ? "occurrence" : payload.participation.scope) === "occurrence"
          ? responseOccurrenceLabel.toLowerCase()
          : "whole series";
      setReminderNotice(
        sendReply
          ? `Response sent: ${savedLabel} (${appliedLabel}).`
          : `Response saved locally: ${savedLabel} (${appliedLabel}).`
      );
    } catch {
      setReminderNotice("Failed to update RSVP response.");
    } finally {
      setSubmittingResponse(false);
    }
  };

  const currentParticipationColor = getParticipationColor(currentMyPartstat);
  const currentParticipationLabel = formatCalendarParticipationLabel(currentMyPartstat) || "Needs action";
  const replyActionLabel = getReplyActionLabel(draftPartstat);
  const inviteStatusText = inviteProcessing
    ? (() => {
        const actionLabel = getInviteActionLabel(inviteProcessing.actionType);
        if (!inviteProcessing.processed) {
          return `${actionLabel} not processed`;
        }
        const processedModeLabel =
          typeof inviteProcessing.processedAutomatically === "boolean"
            ? ` ${inviteProcessing.processedAutomatically ? "automatically" : "manually"}`
            : "";
        const processedAtLabel =
          typeof inviteProcessing.processedAtMs === "number"
            ? formatAccountDateValue(inviteProcessing.processedAtMs, dateFormat)
            : null;
        return `${actionLabel} processed${processedModeLabel}${processedAtLabel ? ` on ${processedAtLabel}` : ""}`;
      })()
    : null;

  return (
    <article className={styles.event}>
      <h5 className={styles.eventTitle}>{title || "Untitled Event"}</h5>

      {inviteProcessing && (
        <EventInviteStatusRow
          inviteProcessing={inviteProcessing}
          inviteStatusText={inviteStatusText}
          hasOccurrenceCancellationAction={hasOccurrenceCancellationAction}
        />
      )}

      <EventDetailMeta
        timeRange={timeRange}
        tzLabel={tzLabel}
        location={location}
        locationUrl={locationUrl}
        recurrenceSummary={recurrenceSummary}
        organizer={organizer}
        attendees={attendees}
      />

      <EventDetailDescription description={description} />

      <EventDetailBadges
        status={status}
        currentMyPartstat={currentMyPartstat}
        participationColor={currentParticipationColor}
        sourceType={sourceType}
      />

      {currentMyPartstat && (canChooseOccurrenceScope || forceOccurrenceResponse) && !hasOccurrenceCancellationAction && (
        <p className={styles.scopeNote}>Your RSVP applies to: {currentScopeLabel}</p>
      )}

      <EventDetailActions
        show={Boolean(canonicalStartMs)}
        hasOccurrenceCancellationAction={hasOccurrenceCancellationAction}
        inviteProcessing={inviteProcessing}
        eventId={eventId}
        canRespond={canRespond}
        currentParticipationColor={currentParticipationColor}
        currentParticipationLabel={currentParticipationLabel}
        submittingResponse={submittingResponse}
        onOpenResponseDialog={openResponseDialog}
        canScheduleReminder={canScheduleReminder}
        existingReminder={existingReminder}
        onOpenReminderDialog={() => setReminderModalOpen(true)}
        deletingReminder={deletingReminder}
        onDeleteReminder={handleDeleteReminder}
        occurrenceMessageId={occurrenceMessageId}
        messageId={messageId}
        onOpenMessage={onOpenMessage}
        canDeleteEvent={Boolean(onEventDeleted)}
        deletingEvent={deletingEvent}
        onDeleteEvent={handleDeleteEvent}
      />

      {replyRequested === false && currentMyPartstat && (
        <p className={styles.notice}>The organizer did not request a reply.</p>
      )}

      {reminderNotice && (
        <p className={styles.notice}>{reminderNotice}</p>
      )}

      {eventSnapshot && (
        <CalendarEventEmailSnapshot
          // Prefer the per-occurrence snapshot (populated by occurrence-only
          // invite updates) when viewing a specific occurrence; otherwise
          // fall back to the series-level snapshot on the event row.
          snapshot={selectCalendarEventEmailSnapshot(eventSnapshot, resolvedStartMs)}
          dateFormat={dateFormat}
        />
      )}

      <EventDeleteScopeDialog
        open={deleteScopeDialogOpen}
        onOpenChange={setDeleteScopeDialogOpen}
        title={title}
        timeRange={timeRange}
        responseOccurrenceLabel={responseOccurrenceLabel}
        responseTargetLabel={responseTargetLabel}
        deletingEvent={deletingEvent}
        onDelete={performDeleteEvent}
      />

      <EventResponseDialog
        open={responseDialogOpen}
        onOpenChange={setResponseDialogOpen}
        title={title}
        timeRange={timeRange}
        responseTargetLabel={responseTargetLabel}
        organizer={organizer}
        draftPartstat={draftPartstat}
        onDraftPartstatChange={setDraftPartstat}
        draftScope={draftScope}
        onDraftScopeChange={setDraftScope}
        canChooseOccurrenceScope={canChooseOccurrenceScope}
        responseOccurrenceLabel={responseOccurrenceLabel}
        sendReply={sendReply}
        onSendReplyChange={setSendReply}
        replyRequested={replyRequested}
        submittingResponse={submittingResponse}
        onSubmit={handleRespond}
        replyActionLabel={replyActionLabel}
        isReplyChoice={isReplyChoice}
      />

      <EventReminderDialog
        open={reminderModalOpen}
        onOpenChange={setReminderModalOpen}
        title={title}
        existingReminder={existingReminder}
        leadOptionValue={leadOptionValue}
        onLeadOptionChange={setLeadOptionValue}
        onSchedule={handleScheduleReminder}
        savingReminder={savingReminder}
      />
    </article>
  );
}
