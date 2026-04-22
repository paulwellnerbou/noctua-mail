"use client";

import { useEffect, useState } from "react";
import { buildCalendarRecurrenceSummary, formatCalendarEventRange } from "@/lib/calendar";
import type { CalendarInviteActionType } from "@/lib/calendarInviteProcessing";
import type {
  AccountDateFormat,
  CalendarEvent,
  CalendarParticipationScope,
  CalendarParticipationStatus
} from "@/lib/data";
import { formatCalendarParticipationLabel } from "@/lib/calendarParticipation";
import { formatCalendarTimeZoneShortLabel } from "@/lib/calendarTimezones";
import { selectCalendarEventEmailSnapshot } from "@/lib/calendarEventEmailSnapshot";
import CalendarEventEmailSnapshot from "./CalendarEventEmailSnapshot";
import EventDeleteScopeDialog from "./EventDeleteScopeDialog";
import EventDetailActions from "./EventDetailActions";
import EventDetailBadges from "./EventDetailBadges";
import EventDetailDescription from "./EventDetailDescription";
import EventDetailMeta from "./EventDetailMeta";
import EventInviteStatusRow from "./EventInviteStatusRow";
import EventReminderDialog from "./EventReminderDialog";
import EventResponseDialog from "./EventResponseDialog";
import { useEventDeleteState } from "./useEventDeleteState";
import { useEventReminderState } from "./useEventReminderState";
import { isReplyChoice, useEventResponseState } from "./useEventResponseState";
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
  showEmailSnapshot?: boolean;
  inviteProcessing?: {
    actionType: CalendarInviteActionType;
    processed: boolean;
    processedAtMs?: number;
    processedAutomatically?: boolean;
    processing?: boolean;
    onProcess?: () => void | Promise<void>;
  };
};

function getParticipationColor(
  status?: CalendarParticipationStatus
): "green" | "red" | "orange" | "gray" {
  if (status === "ACCEPTED") return "green";
  if (status === "DECLINED") return "red";
  if (status === "TENTATIVE") return "orange";
  return "gray";
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
  showEmailSnapshot = true,
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

  const canonicalStartMs = eventStartAtMs ?? resolvedStartMs;
  const [notice, setNotice] = useState<string | null>(null);

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
    onNotice: setNotice
  });
  const resolvedOccurrenceStartAtMs =
    typeof resolvedStartMs === "number" && Number.isFinite(resolvedStartMs)
      ? resolvedStartMs
      : undefined;

  const {
    deletingEvent,
    deleteScopeDialogOpen,
    setDeleteScopeDialogOpen,
    handleDeleteEvent,
    performDeleteEvent
  } = useEventDeleteState({
    accountId,
    eventId,
    eventSnapshot,
    recurrenceRule,
    resolvedOccurrenceStartAtMs,
    onEventDeleted,
    onNotice: setNotice
  });

  const {
    currentMyPartstat,
    canChooseOccurrenceScope,
    currentParticipationScope,
    responseDialogOpen,
    setResponseDialogOpen,
    draftPartstat,
    setDraftPartstat,
    draftScope,
    setDraftScope,
    sendReply,
    setSendReply,
    submittingResponse,
    openResponseDialog,
    handleRespond
  } = useEventResponseState({
    accountId,
    eventId,
    eventUid,
    myPartstat,
    replyRequested,
    canRespond,
    forceOccurrenceResponse,
    recurrenceRule,
    resolvedStartMs,
    responseOccurrenceLabel,
    onEventUpdated,
    onInviteProcessed,
    onNotice: setNotice
  });

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const hasOccurrenceCancellationAction =
    forceOccurrenceResponse &&
    Boolean(inviteProcessing?.onProcess) &&
    inviteProcessing?.actionType === "cancellation";
  const currentScopeLabel = currentParticipationScope === "occurrence"
    ? responseOccurrenceLabel
    : "Whole series";
  const responseTargetLabel = `${responseOccurrenceLabel}: ${timeRange || "Selected event"}`;

  const currentParticipationColor = getParticipationColor(currentMyPartstat);
  const currentParticipationLabel = formatCalendarParticipationLabel(currentMyPartstat) || "Needs action";

  return (
    <article className={styles.event}>
      <h5 className={styles.eventTitle}>{title || "Untitled Event"}</h5>

      {inviteProcessing && (
        <EventInviteStatusRow
          inviteProcessing={inviteProcessing}
          dateFormat={dateFormat}
          hasOccurrenceCancellationAction={hasOccurrenceCancellationAction}
        />
      )}

      <EventDetailMeta
        timeRange={timeRange}
        tzLabel={tzLabel}
        location={location}
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

      {notice && (
        <p className={styles.notice}>{notice}</p>
      )}

      {showEmailSnapshot && eventSnapshot && (
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
