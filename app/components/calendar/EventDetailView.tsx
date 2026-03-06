"use client";

import { useCallback, useEffect, useState } from "react";
import { AlarmClock, AlarmClockPlus, Clock, Mail, MapPin, Repeat, Trash2, User } from "lucide-react";
import { Badge, Button, Dialog, Flex, Select, Switch, Text } from "@radix-ui/themes";
import { buildCalendarRecurrenceSummary, formatCalendarEventDate } from "@/lib/calendar";
import type { CalendarInviteActionType } from "@/lib/calendarInviteProcessing";
import type {
  CalendarEvent,
  CalendarParticipationScope,
  CalendarParticipationStatus
} from "@/lib/data";
import { formatCalendarParticipationLabel } from "@/lib/calendarParticipation";
import { formatCalendarTimeZoneShortLabel } from "@/lib/calendarTimezones";
import { sanitizeHtmlForDisplay, stripStyleTags } from "@/lib/html";
import { resolveNextReminderOccurrence } from "@/lib/reminderRecurrence";
import { linkifyText } from "@/app/components/LinkifiedText";
import {
  CALENDAR_REMINDER_LEAD_OPTIONS,
  deleteCalendarReminder,
  fetchCalendarReminders,
  findActiveCalendarReminderForEvent,
  getCalendarReminderLeadOption,
  upsertCalendarReminder,
  type CalendarReminder
} from "@/app/components/mailclient/utils/calendarReminders";
import styles from "./EventDetailView.module.css";

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
  eventId?: string;
  /** The canonical event start used for reminder matching (e.g. original series start for recurring events) */
  eventStartAtMs?: number;
  eventEndAtMs?: number;
  onOpenMessage?: (messageId: string) => void;
  onEventUpdated?: (event: CalendarEvent) => void;
  onEventDeleted?: () => void;
  onInviteProcessed?: (eventUid: string) => void;
  responseOccurrenceLabel?: string;
  forceOccurrenceResponse?: boolean;
  inviteProcessing?: {
    actionType: CalendarInviteActionType;
    processed: boolean;
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

function enforceSafeLinks(html: string) {
  return html.replace(/<a\b([^>]*)>/gi, (_, attrs: string) => {
    let result = attrs.trim();
    if (!/\btarget\s*=/.test(result)) {
      result = result ? `${result} target="_blank"` : 'target="_blank"';
    }
    if (/\brel\s*=/.test(result)) {
      result = result.replace(
        /\brel\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/i,
        (_m, _full, dq, sq, uq) => {
          const value = dq ?? sq ?? uq ?? "";
          const tokens = value.split(/\s+/).filter(Boolean);
          if (!tokens.includes("noopener")) tokens.push("noopener");
          if (!tokens.includes("noreferrer")) tokens.push("noreferrer");
          return `rel="${tokens.join(" ")}"`;
        }
      );
    } else {
      result = result ? `${result} rel="noreferrer noopener"` : 'rel="noreferrer noopener"';
    }
    return result ? `<a ${result}>` : "<a>";
  });
}

function sanitizeDescriptionHtml(value: string) {
  return enforceSafeLinks(sanitizeHtmlForDisplay(stripStyleTags(value)));
}

function formatTriggerDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const SOURCE_COLORS: Record<string, "blue" | "green" | "indigo"> = {
  local: "blue",
  caldav: "green",
  email: "indigo"
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
  eventId,
  eventStartAtMs,
  eventEndAtMs,
  onOpenMessage,
  onEventUpdated,
  onEventDeleted,
  onInviteProcessed,
  responseOccurrenceLabel = "This occurrence",
  forceOccurrenceResponse = false,
  inviteProcessing
}: EventDetailViewProps) {
  const resolvedStartMs = startMs ?? eventStartAtMs;

  // Time formatting
  const tzLabel = startTimezone && resolvedStartMs
    ? formatCalendarTimeZoneShortLabel(startTimezone, new Date(resolvedStartMs))
    : null;

  const formattedStart = resolvedStartMs
    ? (formatCalendarEventDate(new Date(resolvedStartMs), { allDay, timeZone: startTimezone }) ?? "")
    : "";
  const formattedEnd = endMs
    ? (formatCalendarEventDate(new Date(endMs), { allDay, timeZone: endTimezone ?? startTimezone }) ?? "")
    : "";
  const timeRange = formattedEnd && formattedEnd !== formattedStart
    ? `${formattedStart} – ${formattedEnd}`
    : formattedStart;

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
        const params = new URLSearchParams({
          accountId,
          eventId
        });
        if (Number.isFinite(resolvedStartMs)) {
          params.set("occurrenceStartAtMs", String(resolvedStartMs));
        }
        const res = await fetch(`/api/calendar/events/participation?${params.toString()}`, {
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
          ? `Reminder updated for ${formatTriggerDate(triggerDate)}.`
          : `Reminder scheduled for ${formatTriggerDate(triggerDate)}.`
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

  const handleDeleteEvent = async () => {
    if (!accountId || !eventId) return;
    setDeletingEvent(true);
    try {
      const params = new URLSearchParams({ accountId, soft: "true" });
      await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}?${params.toString()}`, {
        method: "DELETE"
      });
      onEventDeleted?.();
    } catch {
      setReminderNotice("Failed to delete event.");
    } finally {
      setDeletingEvent(false);
    }
  };

  const handleRespond = async () => {
    if (!accountId || !eventId) return;
    if (!isReplyChoice(draftPartstat)) {
      setReminderNotice("Choose a response first.");
      return;
    }
    setSubmittingResponse(true);
    try {
      const res = await fetch(`/api/calendar/events/${encodeURIComponent(eventId)}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
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
        onInviteProcessed?.(eventUid.trim());
      }
      setResponseDialogOpen(false);
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

  return (
    <article className={styles.event}>
      <h5 className={styles.eventTitle}>{title || "Untitled Event"}</h5>

      {inviteProcessing && (
        <div className={styles.inviteStatusRow}>
          <Text size="1" color={inviteProcessing.processed ? "green" : "gray"}>
            {inviteProcessing.actionType === "cancellation"
              ? "Cancellation"
              : inviteProcessing.actionType === "update"
                ? "Update"
                : "Invitation"}{" "}
            {inviteProcessing.processed ? "processed" : "not processed"}
          </Text>
          {!inviteProcessing.processed && inviteProcessing.onProcess && !hasOccurrenceCancellationAction && (
            <Button
              size="1"
              variant="soft"
              color="indigo"
              disabled={inviteProcessing.processing}
              onClick={() => void inviteProcessing.onProcess?.()}
            >
              {inviteProcessing.processing ? "Processing…" : "Process"}
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
        <div className={styles.metaRow}>
          <User size={12} />
          <span>{organizer}</span>
        </div>
      )}

      {/* Attendees */}
      {attendees && attendees.length > 0 && (
        <div className={styles.metaRow}>
          <User size={12} />
          <Flex direction="column" gap="1">
            <Text size="1" color="gray">Attendees</Text>
            {attendees.map((a) => <Text key={a} size="2">{a}</Text>)}
          </Flex>
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
              {sourceType}
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
          {messageId && onOpenMessage && (
            <Button size="1" variant="soft" color="gray" onClick={() => onOpenMessage(messageId)}>
              <Mail size={12} />
              Open email
            </Button>
          )}
          {eventId && currentMyPartstat === "DECLINED" && onEventDeleted && (
            <Button
              size="1"
              variant="soft"
              color="red"
              disabled={deletingEvent}
              onClick={() => void handleDeleteEvent()}
            >
              <Trash2 size={14} />
              {deletingEvent ? "Removing…" : "Remove declined event"}
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

      <Dialog.Root
        open={responseDialogOpen}
        onOpenChange={(open) => {
          if (!open && !submittingResponse) setResponseDialogOpen(false);
        }}
      >
        <Dialog.Content size="2" className={styles.responseDialog}>
          <Flex direction="column" gap="3">
            <Dialog.Title size="4">Respond to invitation</Dialog.Title>

            <div className={styles.responseSummary}>
              <Text size="2" weight="medium">{title || "Untitled Event"}</Text>
              {timeRange && (
                <Text size="1" color="gray">{responseTargetLabel}</Text>
              )}
              {organizer && (
                <Text size="1" color="gray">Organizer: {organizer}</Text>
              )}
            </div>

            <Flex direction="column" gap="2">
              <Text size="2" weight="medium">Your response</Text>
              <Flex gap="2" wrap="wrap">
                <Button
                  size="1"
                  variant={draftPartstat === "ACCEPTED" ? "solid" : "soft"}
                  color="green"
                  onClick={() => setDraftPartstat("ACCEPTED")}
                >
                  Accept
                </Button>
                <Button
                  size="1"
                  variant={draftPartstat === "TENTATIVE" ? "solid" : "soft"}
                  color="orange"
                  onClick={() => setDraftPartstat("TENTATIVE")}
                >
                  Tentative
                </Button>
                <Button
                  size="1"
                  variant={draftPartstat === "DECLINED" ? "solid" : "soft"}
                  color="red"
                  onClick={() => setDraftPartstat("DECLINED")}
                >
                  Decline
                </Button>
              </Flex>
            </Flex>

            {canChooseOccurrenceScope && (
              <Flex direction="column" gap="2">
                <Text size="2" weight="medium">Apply to</Text>
                <Select.Root
                  value={draftScope}
                  onValueChange={(value) => setDraftScope(value as CalendarParticipationScope)}
                >
                  <Select.Trigger />
                  <Select.Content position="popper">
                    <Select.Item value="occurrence">{responseOccurrenceLabel}</Select.Item>
                    <Select.Item value="series">Whole series</Select.Item>
                  </Select.Content>
                </Select.Root>
              </Flex>
            )}

            <Flex direction="column" gap="2">
              <Text size="2" weight="medium">Notify organizer</Text>
              <Flex align="center" justify="between" gap="3" className={styles.responseToggleRow}>
                <div className={styles.responseToggleText}>
                  <Text size="2">Send reply email</Text>
                  {replyRequested === false && (
                    <Text size="1" color="gray">
                      The organizer did not request a reply. You can still send one.
                    </Text>
                  )}
                </div>
                <Switch
                  checked={sendReply}
                  onCheckedChange={setSendReply}
                  disabled={submittingResponse}
                  aria-label="Send reply to organizer"
                />
              </Flex>
            </Flex>

            <Flex justify="end" gap="2">
              <Button
                variant="soft"
                color="gray"
                disabled={submittingResponse}
                onClick={() => setResponseDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={submittingResponse || !isReplyChoice(draftPartstat)}
                onClick={() => void handleRespond()}
              >
                {submittingResponse
                  ? "Saving..."
                  : sendReply
                    ? `${replyActionLabel} and send response`
                    : `${replyActionLabel} and save without sending response`}
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Reminder modal */}
      <Dialog.Root open={reminderModalOpen} onOpenChange={(open) => { if (!open) setReminderModalOpen(false); }}>
        <Dialog.Content size="2" className={styles.reminderDialog}>
          <Flex direction="column" gap="3">
            <Dialog.Title size="4">{existingReminder ? "Modify Reminder" : "Schedule Reminder"}</Dialog.Title>
            <Text size="2" color="gray">{title || "Calendar event"}</Text>
            {existingReminder && (
              <Text size="2" color="gray">
                Current: {existingReminder.leadLabel}
              </Text>
            )}
            <Flex direction="column" gap="2">
              <Text size="2" weight="medium">Notify me</Text>
              <Select.Root value={leadOptionValue} onValueChange={setLeadOptionValue}>
                <Select.Trigger />
                <Select.Content position="popper">
                  {CALENDAR_REMINDER_LEAD_OPTIONS.map((opt) => (
                    <Select.Item key={opt.value} value={opt.value}>{opt.label}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
            <Flex justify="end" gap="2">
              <Button variant="soft" color="gray" onClick={() => setReminderModalOpen(false)} disabled={savingReminder}>
                Cancel
              </Button>
              <Button onClick={() => void handleScheduleReminder()} disabled={savingReminder}>
                {savingReminder ? "Saving…" : existingReminder ? "Update reminder" : "Schedule reminder"}
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </article>
  );
}
