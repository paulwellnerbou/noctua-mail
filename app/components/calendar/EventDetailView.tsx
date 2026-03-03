"use client";

import { useCallback, useEffect, useState } from "react";
import { AlarmClock, AlarmClockPlus, Clock, Mail, MapPin, Repeat, Trash2, User } from "lucide-react";
import { Badge, Button, Dialog, Flex, Select, Text } from "@radix-ui/themes";
import { buildCalendarRecurrenceSummary, formatCalendarEventDate } from "@/lib/calendar";
import type { CalendarInviteActionType } from "@/lib/calendarInviteProcessing";
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
  sourceType?: string;
  messageId?: string;
  /** The canonical event start used for reminder matching (e.g. original series start for recurring events) */
  eventStartAtMs?: number;
  eventEndAtMs?: number;
  onOpenMessage?: (messageId: string) => void;
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
  sourceType,
  messageId,
  eventStartAtMs,
  eventEndAtMs,
  onOpenMessage,
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
          {!inviteProcessing.processed && inviteProcessing.onProcess && (
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
      {(status || sourceType) && (
        <div className={styles.badges}>
          {status && (
            <Badge size="1" color={status === "CANCELLED" ? "red" : status === "TENTATIVE" ? "orange" : "gray"} variant="soft">
              {status}
            </Badge>
          )}
          {sourceType && (
            <Badge size="1" color={SOURCE_COLORS[sourceType] ?? "gray"} variant="soft">
              {sourceType}
            </Badge>
          )}
        </div>
      )}

      {/* Reminder controls */}
      {canonicalStartMs && (
        <div className={styles.actions}>
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
              {deletingReminder ? "Removing…" : "Remove"}
            </Button>
          )}
          {messageId && onOpenMessage && (
            <Button size="1" variant="soft" color="gray" onClick={() => onOpenMessage(messageId)}>
              <Mail size={12} />
              Open email
            </Button>
          )}
        </div>
      )}

      {reminderNotice && (
        <p className={styles.notice}>{reminderNotice}</p>
      )}

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
