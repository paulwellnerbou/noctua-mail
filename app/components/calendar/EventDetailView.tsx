"use client";

import { useCallback, useEffect, useState } from "react";
import { AlarmClock, AlarmClockPlus, Clock, Mail, MapPin, Repeat, Trash2, User, Users } from "lucide-react";
import { AlertDialog, Badge, Button, Flex, Text } from "@radix-ui/themes";
import { buildCalendarRecurrenceSummary, formatCalendarEventRange } from "@/lib/calendar";
import type { CalendarInviteActionType } from "@/lib/calendarInviteProcessing";
import { formatAccountDateValue, formatAccountMediumDateTime } from "@/lib/dateFormatting";
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
import {
  enforceSafeLinks,
  linkifyHtmlTextNodes,
  sanitizeHtmlForDisplay,
  stripStyleTags
} from "@/lib/html";
import { resolveNextReminderOccurrence } from "@/lib/reminderRecurrence";
import { linkifyText } from "@/app/components/LinkifiedText";
import {
  CALENDAR_REMINDER_LEAD_OPTIONS,
  deleteCalendarReminder,
  fetchCalendarReminders,
  findActiveCalendarReminderForEvent,
  getCalendarReminderLeadOption,
  dispatchCalendarRemindersUpdatedEvent,
  upsertCalendarReminder,
  type CalendarReminder
} from "@/app/components/mailclient/utils/calendarReminders";
import AlertDialogContent from "@/app/components/mailclient/message/AlertDialogContent";
import { dispatchCalendarEventsUpdatedEvent } from "./calendarEventsClient";
import CalendarEventEmailSnapshot from "./CalendarEventEmailSnapshot";
import EventReminderDialog from "./EventReminderDialog";
import EventResponseDialog from "./EventResponseDialog";
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

function looksLikeHtml(value: string) {
  return /<\s*\/?\s*[a-z][\w:-]*(\s[^>]*?)?>/i.test(value);
}

function sanitizeDescriptionHtml(value: string) {
  return enforceSafeLinks(linkifyHtmlTextNodes(sanitizeHtmlForDisplay(stripStyleTags(value))));
}

function formatTriggerDate(date: Date, dateFormat?: AccountDateFormat) {
  return formatAccountMediumDateTime(date.getTime(), dateFormat) ?? "";
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

const SOURCE_COLORS: Record<string, "blue" | "green" | "indigo"> = {
  local: "blue",
  caldav: "green",
  email: "indigo",
  "sent-invite": "indigo"
};

const SOURCE_LABELS: Record<string, string> = {
  local: "local",
  caldav: "caldav",
  email: "email",
  "sent-invite": "sent invite"
};

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

function getOccurrenceInviteActionLabel(actionType?: CalendarInviteActionType) {
  if (actionType === "cancellation") return "RSVP: Cancel";
  return "RSVP";
}

function getInviteActionLabel(actionType: CalendarInviteActionType) {
  if (actionType === "cancellation") return "Cancellation";
  if (actionType === "update") return "Update";
  return "Invitation";
}

function getInviteProcessButtonLabel(processed?: boolean) {
  return processed ? "Reprocess" : "Process";
}

function getInviteProcessButtonPendingLabel(processed?: boolean) {
  return processed ? "Reprocessing…" : "Processing…";
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

  // Description
  const trimmedDescription = description?.trim() ?? "";
  const descriptionHtml = trimmedDescription && looksLikeHtml(trimmedDescription)
    ? sanitizeDescriptionHtml(trimmedDescription)
    : "";
  const useHtmlDescription = Boolean(descriptionHtml);

  // Location URL
  const locationUrl = parseHttpUrl(location);

  // Reminder state
  const canonicalStartMs = eventStartAtMs ?? resolvedStartMs;
  const [existingReminder, setExistingReminder] = useState<CalendarReminder | null>(null);
  const [reminderModalOpen, setReminderModalOpen] = useState(false);
  const [leadOptionValue, setLeadOptionValue] = useState(CALENDAR_REMINDER_LEAD_OPTIONS[3]?.value ?? "15");
  const [savingReminder, setSavingReminder] = useState(false);
  const [deletingReminder, setDeletingReminder] = useState(false);
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);
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

  const canScheduleReminder = (() => {
    if (!canonicalStartMs) return false;
    const nowMs = Date.now();
    if (!recurrenceRule?.trim()) return canonicalStartMs > nowMs;
    const next = resolveNextReminderOccurrence({
      eventStartAtMs: canonicalStartMs,
      eventEndAtMs: eventEndAtMs,
      leadMinutes: 0,
      recurrenceRule,
      recurrenceDates,
      excludedDates
    }, nowMs);
    return Boolean(next && next.eventStartAtMs > nowMs);
  })();

  const refreshReminder = useCallback(async () => {
    if (!accountId || !canonicalStartMs) return;
    try {
      const reminders = await fetchCalendarReminders(accountId);
      const found = findActiveCalendarReminderForEvent(reminders, {
        eventUid,
        eventTitle: title,
        eventStartAtMs: canonicalStartMs
      });
      setExistingReminder(found);
      if (found) {
        const val = String(found.leadMinutes);
        const has = CALENDAR_REMINDER_LEAD_OPTIONS.some((o) => o.value === val);
        setLeadOptionValue(has ? val : (CALENDAR_REMINDER_LEAD_OPTIONS[3]?.value ?? "15"));
      }
    } catch {
      // ignore
    }
  }, [accountId, eventUid, title, canonicalStartMs]);

  useEffect(() => { void refreshReminder(); }, [refreshReminder]);

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

  const handleScheduleReminder = async () => {
    if (!accountId || !canonicalStartMs) return;
    setSavingReminder(true);
    try {
      const option = getCalendarReminderLeadOption(leadOptionValue);
      const stored = await upsertCalendarReminder(accountId, {
        eventUid,
        eventTitle: title,
        eventLocation: location,
        eventDescription: description,
        eventStartAtMs: canonicalStartMs,
        eventEndAtMs: eventEndAtMs,
        messageId,
        startTimezone,
        recurrenceRule,
        recurrenceDates,
        excludedDates,
        leadMinutes: option.minutes,
        leadLabel: option.label
      });
      const triggerDate = new Date(stored.reminder.triggerAtMs > Date.now() ? stored.reminder.triggerAtMs : Date.now());
      setReminderNotice(
        stored.replaced
          ? `Reminder updated for ${formatTriggerDate(triggerDate, dateFormat)}.`
          : `Reminder scheduled for ${formatTriggerDate(triggerDate, dateFormat)}.`
      );
      setReminderModalOpen(false);
      await refreshReminder();
    } catch {
      setReminderNotice("Failed to save reminder.");
    } finally {
      setSavingReminder(false);
    }
  };

  const handleDeleteReminder = async () => {
    if (!accountId || !existingReminder) return;
    setDeletingReminder(true);
    try {
      await deleteCalendarReminder(accountId, existingReminder.id);
      setExistingReminder(null);
      setReminderNotice("Reminder removed.");
    } catch {
      setReminderNotice("Failed to remove reminder.");
    } finally {
      setDeletingReminder(false);
    }
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
        <div className={styles.inviteStatusRow}>
          <Text size="1" color={inviteProcessing.processed ? "green" : "gray"}>
            {inviteStatusText}
          </Text>
          {inviteProcessing.onProcess && !hasOccurrenceCancellationAction && (
            <Button
              size="1"
              variant="soft"
              color="indigo"
              disabled={inviteProcessing.processing}
              onClick={() => void inviteProcessing.onProcess?.()}
            >
              {inviteProcessing.processing
                ? getInviteProcessButtonPendingLabel(inviteProcessing.processed)
                : getInviteProcessButtonLabel(inviteProcessing.processed)}
            </Button>
          )}
        </div>
      )}

      {/* Time */}
      {timeRange && (
        <div className={styles.metaRow}>
          <Clock size={12} />
          <span>{timeRange}</span>
          {tzLabel && <span className={styles.tzLabel}>({tzLabel})</span>}
        </div>
      )}

      {/* Location */}
      {location && (
        <div className={styles.metaRow}>
          <MapPin size={12} />
          {locationUrl ? (
            <a className={styles.locationLink} href={locationUrl} target="_blank" rel="noreferrer">
              {location}
            </a>
          ) : (
            <span>{location}</span>
          )}
        </div>
      )}

      {/* Recurrence */}
      {recurrenceSummary && (
        <div className={styles.metaRow}>
          <Repeat size={12} />
          <span>{recurrenceSummary}</span>
        </div>
      )}

      {/* Organizer */}
      {organizer && (
        <div className={styles.metaRowWrap}>
          <User size={14} className={styles.metaIcon} aria-hidden />
          <span className={styles.metaText}>
            <span className={styles.metaInlineLabel}>Organizer:</span> {organizer}
          </span>
        </div>
      )}

      {/* Attendees */}
      {attendees && attendees.length > 0 && (
        <div className={styles.metaRowWrap}>
          <Users size={14} className={styles.metaIcon} aria-hidden />
          <span className={styles.metaText}>
            <span className={styles.metaInlineLabel}>Attendees:</span> {attendees.join(", ")}
          </span>
        </div>
      )}

      {/* Description */}
      {trimmedDescription && (
        <div className={styles.description}>
          <span className={styles.descriptionLabel}>Description</span>
          {useHtmlDescription ? (
            <div className={styles.descriptionText} dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
          ) : (
            <span className={styles.descriptionText}>
              {linkifyText(trimmedDescription, styles.descriptionLink)}
            </span>
          )}
        </div>
      )}

      {/* Badges */}
      {(status || currentMyPartstat || sourceType) && (
        <div className={styles.badges}>
          {status && (
            <Badge size="1" color={status === "CANCELLED" ? "red" : status === "TENTATIVE" ? "orange" : "gray"} variant="soft">
              {status}
            </Badge>
          )}
          {currentMyPartstat && (
            <Badge
              size="1"
              color={currentParticipationColor}
              variant="soft"
            >
              You: {formatCalendarParticipationLabel(currentMyPartstat)}
            </Badge>
          )}
          {sourceType && (
            <Badge size="1" color={SOURCE_COLORS[sourceType] ?? "gray"} variant="soft">
              {SOURCE_LABELS[sourceType] ?? sourceType}
            </Badge>
          )}
        </div>
      )}

      {currentMyPartstat && (canChooseOccurrenceScope || forceOccurrenceResponse) && !hasOccurrenceCancellationAction && (
        <p className={styles.scopeNote}>Your RSVP applies to: {currentScopeLabel}</p>
      )}

      {/* Reminder controls */}
      {canonicalStartMs && (
        <div className={styles.actions}>
          {hasOccurrenceCancellationAction && !inviteProcessing?.processed && (
            <Button
              size="1"
              variant="soft"
              color={inviteProcessing?.actionType === "cancellation" ? "red" : "indigo"}
              disabled={Boolean(inviteProcessing?.processing)}
              onClick={() => void inviteProcessing?.onProcess?.()}
            >
              {inviteProcessing?.processing
                ? inviteProcessing.actionType === "cancellation"
                  ? "Cancelling..."
                  : "Updating..."
                : getOccurrenceInviteActionLabel(inviteProcessing?.actionType)}
            </Button>
          )}
          {eventId && canRespond && !hasOccurrenceCancellationAction && (
            <Button
              size="1"
              variant="soft"
              color={currentParticipationColor}
              disabled={submittingResponse}
              onClick={openResponseDialog}
            >
              RSVP: {currentParticipationLabel}
            </Button>
          )}
          <Button
            size="1"
            variant="soft"
            color="indigo"
            disabled={!canScheduleReminder && !existingReminder}
            title={!canScheduleReminder && !existingReminder ? "Past events cannot be scheduled" : undefined}
            onClick={() => setReminderModalOpen(true)}
          >
            {existingReminder ? <AlarmClock size={14} /> : <AlarmClockPlus size={14} />}
            {existingReminder ? "Modify Reminder" : "Schedule Reminder"}
          </Button>
          {existingReminder && (
            <Button
              size="1"
              variant="soft"
              color="gray"
              disabled={deletingReminder}
              onClick={() => void handleDeleteReminder()}
            >
              <Trash2 size={14} />
              {deletingReminder ? "Removing…" : "Remove reminder"}
            </Button>
          )}
          {occurrenceMessageId && onOpenMessage && (
            <Button
              size="1"
              variant="soft"
              color="gray"
              onClick={() => onOpenMessage(occurrenceMessageId)}
            >
              <Mail size={12} />
              Open occurrence email
            </Button>
          )}
          {messageId && onOpenMessage && (
            <Button size="1" variant="soft" color="gray" onClick={() => onOpenMessage(messageId)}>
              <Mail size={12} />
              {occurrenceMessageId ? "Open series email" : "Open email"}
            </Button>
          )}
          {eventId && onEventDeleted && (
            <Button
              size="1"
              variant="soft"
              color="red"
              disabled={deletingEvent}
              onClick={handleDeleteEvent}
            >
              <Trash2 size={14} />
              {deletingEvent ? "Removing…" : "Delete event"}
            </Button>
          )}
        </div>
      )}

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

      <AlertDialog.Root
        open={deleteScopeDialogOpen}
        onOpenChange={(open) => {
          if (!deletingEvent) {
            setDeleteScopeDialogOpen(open);
          }
        }}
      >
        <AlertDialogContent size="2">
          <AlertDialog.Title size="3">Delete recurring event?</AlertDialog.Title>
          <AlertDialog.Description>
            Choose whether to remove only {responseOccurrenceLabel.toLowerCase()} or delete the whole series.
          </AlertDialog.Description>
          <div className={styles.responseSummary}>
            <Text size="2" weight="medium">{title || "Untitled Event"}</Text>
            {timeRange && (
              <Text size="1" color="gray">{responseTargetLabel}</Text>
            )}
          </div>
          <Flex gap="3" mt="4" justify="end" wrap="wrap">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" disabled={deletingEvent}>
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="soft"
                color="gray"
                disabled={deletingEvent}
                onClick={() => void performDeleteEvent("occurrence")}
              >
                {responseOccurrenceLabel}
              </Button>
            </AlertDialog.Action>
            <AlertDialog.Action>
              <Button
                color="red"
                disabled={deletingEvent}
                onClick={() => void performDeleteEvent("series")}
              >
                Whole series
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialogContent>
      </AlertDialog.Root>

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
