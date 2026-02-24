import { useCallback, useEffect, useMemo, useState } from "react";
import { AlarmClock, AlarmClockPlus, CalendarDays, Clock, Info, MapPin, Search, Trash2 } from "lucide-react";
import { Badge, Button, Dialog, Flex, IconButton, Select, Text } from "@radix-ui/themes";
import type { Attachment } from "@/lib/data";
import {
  buildCalendarRecurrenceSummary,
  formatCalendarEventDate,
  parseIcsEvents,
  type CalendarEventPreview
} from "@/lib/calendar";
import { isCalendarAttachment } from "@/lib/messageFlags";
import { resolveNextReminderOccurrence } from "@/lib/reminderRecurrence";
import { linkifyText } from "@/app/components/LinkifiedText";
import {
  CALENDAR_REMINDERS_UPDATED_EVENT,
  CALENDAR_REMINDER_LEAD_OPTIONS,
  type CalendarReminder,
  deleteCalendarReminderForEvent,
  fetchCalendarReminders,
  findActiveCalendarReminderForEvent,
  getCalendarReminderLeadOption,
  upsertCalendarReminder
} from "../utils/calendarReminders";
import { groupItemsByRelativeTime } from "../utils/relativeTimeGroups";
import DialogTitleBar from "./DialogTitleBar";
import RawTextPanel from "./RawTextPanel";
import styles from "./CalendarEventPreview.module.css";

function readDataUrl(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex < 0) return "";
  const header = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  if (header.includes(";base64")) {
    try {
      return atob(payload);
    } catch {
      return "";
    }
  }
  try {
    return decodeURIComponent(payload);
  } catch {
    return payload;
  }
}

function formatDateRange(
  event: CalendarEventPreview,
  startDate = event.start,
  endDate = event.end
) {
  const start = formatCalendarEventDate(startDate, {
    allDay: event.allDay,
    timeZone: event.startTimezone
  });
  const end = formatCalendarEventDate(endDate, {
    allDay: event.allDay,
    timeZone: event.endTimezone
  });
  if (!start) return "";
  if (!end) return start;
  return `${start} - ${end}`;
}

function parseHttpUrl(value?: string) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function extractIcsUid(rawSource: string) {
  if (!rawSource) return "";
  const unfolded = normalizeLineEndings(rawSource).replace(/\n[ \t]/g, "");
  const lines = unfolded.split("\n");
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toUpperCase();
    if (key !== "UID" && !key.startsWith("UID;")) continue;
    const uid = line.slice(separator + 1).trim();
    if (uid) return uid;
  }
  return "";
}

function formatReminderTrigger(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function toMsArray(values?: Date[]) {
  if (!values || values.length === 0) return undefined;
  const next = values
    .map((value) => value.getTime())
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.round(value));
  return next.length > 0 ? next : undefined;
}

function resolveEventReminderOccurrence(
  event: CalendarEventPreview,
  leadMinutes: number,
  nowMs = Date.now()
) {
  if (!event.start) return null;
  return resolveNextReminderOccurrence({
    eventStartAtMs: event.start.getTime(),
    eventEndAtMs: event.end?.getTime(),
    leadMinutes,
    startTimezone: event.startTimezone,
    recurrenceRule: event.recurrenceRule,
    recurrenceDates: toMsArray(event.recurrenceDates),
    excludedDates: toMsArray(event.excludedDates)
  }, nowMs);
}

function resolveEventDisplayRange(event: CalendarEventPreview, nowMs = Date.now()) {
  if (!event.start) {
    return {
      start: undefined,
      end: undefined,
      startAtMs: Number.NaN
    };
  }

  const startAtMs = event.start.getTime();
  if (!event.recurrenceRule?.trim()) {
    return {
      start: event.start,
      end: event.end,
      startAtMs
    };
  }

  const nextOccurrence = resolveEventReminderOccurrence(event, 0, nowMs);
  const displayStartAtMs = nextOccurrence?.eventStartAtMs ?? startAtMs;
  const durationMs = event.end ? event.end.getTime() - startAtMs : Number.NaN;
  const hasDuration = Number.isFinite(durationMs) && durationMs > 0;
  const displayEndAtMs = hasDuration ? displayStartAtMs + durationMs : Number.NaN;

  return {
    start: new Date(displayStartAtMs),
    end: Number.isFinite(displayEndAtMs) ? new Date(displayEndAtMs) : undefined,
    startAtMs: displayStartAtMs
  };
}

function canScheduleReminderForEvent(event: CalendarEventPreview, nowMs = Date.now()) {
  if (!event.start) return false;
  if (!event.recurrenceRule?.trim()) {
    return event.start.getTime() > nowMs;
  }
  const occurrence = resolveEventReminderOccurrence(event, 0, nowMs);
  return Boolean(occurrence && occurrence.eventStartAtMs > nowMs);
}

type ReminderModalState = {
  event: CalendarEventPreview;
};

export default function CalendarEventPreview({
  attachments,
  accountId,
  sourceMessageId,
  onFindRelatedByInviteUid
}: {
  attachments: Attachment[];
  accountId: string;
  sourceMessageId?: string;
  onFindRelatedByInviteUid?: (uid: string) => void;
}) {
  const attachment = useMemo(
    () => attachments.find((item) => isCalendarAttachment(item) && Boolean(item.url || item.dataUrl)) ?? null,
    [attachments]
  );
  const [result, setResult] = useState<{
    attachmentId: string;
    events: CalendarEventPreview[];
    rawSource: string;
    error: boolean;
  }>({
    attachmentId: "",
    events: [],
    rawSource: "",
    error: false
  });
  const [reminderModal, setReminderModal] = useState<ReminderModalState | null>(null);
  const [leadOptionValue, setLeadOptionValue] = useState(
    CALENDAR_REMINDER_LEAD_OPTIONS[3]?.value ?? "15"
  );
  const [pendingReminders, setPendingReminders] = useState<CalendarReminder[]>([]);
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);
  const [savingReminder, setSavingReminder] = useState(false);
  const [rawIcsOpen, setRawIcsOpen] = useState(false);

  const refreshPendingReminders = useCallback(async () => {
    if (!accountId.trim()) {
      setPendingReminders([]);
      return;
    }
    try {
      const reminders = await fetchCalendarReminders(accountId);
      setPendingReminders(reminders);
    } catch {
      // ignore failures for inline reminder UI
    }
  }, [accountId]);

  useEffect(() => {
    let active = true;
    if (!attachment) return;
    const load = async () => {
      try {
        const source = attachment.dataUrl
          ? readDataUrl(attachment.dataUrl)
          : attachment.url
            ? await fetch(attachment.url).then((res) => (res.ok ? res.text() : ""))
            : "";
        if (!active) return;
        const parsed = parseIcsEvents(source);
        setResult({
          attachmentId: attachment.id,
          events: parsed,
          rawSource: source,
          error: parsed.length === 0
        });
      } catch {
        if (!active) return;
        setResult({
          attachmentId: attachment.id,
          events: [],
          rawSource: "",
          error: true
        });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [attachment]);

  useEffect(() => {
    if (!reminderNotice) return;
    const timer = window.setTimeout(() => setReminderNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [reminderNotice]);

  useEffect(() => {
    void refreshPendingReminders();
  }, [refreshPendingReminders]);

  useEffect(() => {
    const handleUpdate = () => {
      void refreshPendingReminders();
    };
    window.addEventListener(CALENDAR_REMINDERS_UPDATED_EVENT, handleUpdate);
    return () => {
      window.removeEventListener(CALENDAR_REMINDERS_UPDATED_EVENT, handleUpdate);
    };
  }, [refreshPendingReminders]);

  const hasCurrentResult = Boolean(attachment && result.attachmentId === attachment.id);
  const events = hasCurrentResult ? result.events : [];
  const rawSource = hasCurrentResult ? result.rawSource : "";
  const normalizedRawSource = normalizeLineEndings(rawSource);
  const canViewRawIcs = normalizedRawSource.trim().length > 0;
  const rawIcsUid =
    events.find((event) => (event.uid ?? "").trim().length > 0)?.uid?.trim() ??
    extractIcsUid(normalizedRawSource);
  const relatedInviteUid = rawIcsUid?.trim() ?? "";
  const groupedEvents = useMemo(() => {
    const nowMs = Date.now();
    const sourceEvents = (hasCurrentResult ? result.events : []).slice(0, 3);
    const entries = sourceEvents.map((event, index) => {
      const displayRange = resolveEventDisplayRange(event, nowMs);
      return {
        event,
        index,
        displayStart: displayRange.start,
        displayEnd: displayRange.end,
        displayStartAtMs: displayRange.startAtMs
      };
    });
    return groupItemsByRelativeTime(entries, (entry) => entry.displayStartAtMs, nowMs);
  }, [hasCurrentResult, result.events]);
  const loading = !hasCurrentResult;
  const hasError = hasCurrentResult && result.error;

  if (!attachment) return null;

  const downloadFilename = (() => {
    const name = attachment.filename || "invite.ics";
    return name.toLowerCase().endsWith(".ics") ? name : `${name}.ics`;
  })();

  const openReminderModal = (event: CalendarEventPreview) => {
    if (!event.start) return;
    if (!canScheduleReminderForEvent(event)) {
      setReminderNotice("Past events cannot be scheduled.");
      return;
    }
    setReminderModal({ event });
    const existingReminder =
      event.start
        ? findActiveCalendarReminderForEvent(pendingReminders, {
            eventUid: event.uid,
            eventTitle: event.summary || "Calendar event",
            eventStartAtMs: event.start.getTime()
          })
        : null;
    const existingLeadValue = existingReminder !== null ? String(existingReminder.leadMinutes) : "";
    const hasExistingLead = CALENDAR_REMINDER_LEAD_OPTIONS.some(
      (option) => option.value === existingLeadValue
    );
    setLeadOptionValue(
      hasExistingLead ? existingLeadValue : CALENDAR_REMINDER_LEAD_OPTIONS[3]?.value ?? "15"
    );
  };

  const closeReminderModal = () => {
    setReminderModal(null);
  };

  const scheduleReminder = async () => {
    const target = reminderModal?.event;
    if (!target?.start) {
      setReminderNotice("Reminder could not be scheduled: event start is missing.");
      closeReminderModal();
      return;
    }
    if (!canScheduleReminderForEvent(target)) {
      setReminderNotice("Past events cannot be scheduled.");
      closeReminderModal();
      return;
    }
    const option = getCalendarReminderLeadOption(leadOptionValue);
    const nextOccurrence = resolveEventReminderOccurrence(target, option.minutes);
    if (!nextOccurrence) {
      setReminderNotice("No future occurrence found for this event.");
      closeReminderModal();
      return;
    }
    setSavingReminder(true);
    try {
      const stored = await upsertCalendarReminder(accountId, {
        messageId: sourceMessageId,
        eventUid: target.uid,
        eventTitle: target.summary || "Calendar event",
        eventLocation: target.location,
        eventDescription: target.description,
        eventStartAtMs: target.start.getTime(),
        eventEndAtMs: target.end?.getTime(),
        startTimezone: target.startTimezone,
        recurrenceRule: target.recurrenceRule,
        recurrenceDates: toMsArray(target.recurrenceDates),
        excludedDates: toMsArray(target.excludedDates),
        leadMinutes: option.minutes,
        leadLabel: option.label
      });
      const triggerDate = new Date(
        stored.reminder.triggerAtMs > Date.now() ? stored.reminder.triggerAtMs : Date.now()
      );
      setReminderNotice(
        stored.replaced
          ? `Reminder updated for ${formatReminderTrigger(triggerDate)}.`
          : `Reminder scheduled for ${formatReminderTrigger(triggerDate)}.`
      );
      closeReminderModal();
      await refreshPendingReminders();
    } catch {
      setReminderNotice("Failed to schedule reminder.");
    } finally {
      setSavingReminder(false);
    }
  };

  const removeReminder = async (event: CalendarEventPreview) => {
    if (!event.start) return;
    try {
      const deleted = await deleteCalendarReminderForEvent(accountId, {
        eventUid: event.uid,
        eventTitle: event.summary || "Calendar event",
        eventStartAtMs: event.start.getTime()
      });
      setReminderNotice(deleted ? "Reminder removed." : "No reminder found to remove.");
      await refreshPendingReminders();
    } catch {
      setReminderNotice("Failed to remove reminder.");
    }
  };

  return (
    <section className={styles.preview}>
      <div className={styles.header}>
        <div className={styles.title}>
          <CalendarDays size={14} />
          <span>Calendar Event</span>
        </div>
        <Flex align="center" gap="2" className={styles.attachmentControls}>
          <a
            className={styles.attachmentLink}
            href={attachment.url ?? attachment.dataUrl ?? "#"}
            onClick={(event) => {
              if (!attachment.url && !attachment.dataUrl) {
                event.preventDefault();
              }
            }}
          >
            <Badge size="1" variant="soft" color="indigo" className={styles.attachmentBadge}>
              {downloadFilename}
            </Badge>
          </a>
          <Dialog.Root open={rawIcsOpen} onOpenChange={setRawIcsOpen}>
            <IconButton
              size="1"
              variant="soft"
              color="gray"
              className={styles.infoButton}
              title="Find related"
              aria-label="Find related"
              disabled={!relatedInviteUid || !onFindRelatedByInviteUid}
              onClick={() => {
                if (!relatedInviteUid) return;
                onFindRelatedByInviteUid?.(relatedInviteUid);
              }}
            >
              <Search size={12} />
            </IconButton>
            <IconButton
              size="1"
              variant="soft"
              color="gray"
              className={styles.infoButton}
              title="Show raw ICS content"
              aria-label="Show raw ICS content"
              disabled={!canViewRawIcs}
              onClick={() => setRawIcsOpen(true)}
            >
              <Info size={12} />
            </IconButton>
            <Dialog.Content size="4" className={styles.rawIcsDialog}>
              <Flex direction="column" gap="3">
                <DialogTitleBar title="Raw ICS Content" onClose={() => setRawIcsOpen(false)} />
                <Text size="2" color="gray">
                  {downloadFilename}
                </Text>
                {rawIcsUid ? (
                  <div className={styles.uidRow}>
                    <span className={styles.uidLabel}>UID</span>
                    <span className={styles.uidValue}>{rawIcsUid}</span>
                  </div>
                ) : null}
                <RawTextPanel
                  text={canViewRawIcs ? normalizedRawSource : ""}
                  copyText={canViewRawIcs ? normalizedRawSource : ""}
                  copyLabel="Copy ICS"
                  emptyText="Raw ICS content is unavailable."
                  className={styles.rawIcsPanel}
                />
              </Flex>
            </Dialog.Content>
          </Dialog.Root>
        </Flex>
      </div>
      {loading ? (
        <p className={styles.meta}>Loading event preview…</p>
      ) : hasError || events.length === 0 ? (
        <p className={styles.meta}>Could not parse calendar event details.</p>
      ) : (
        <div className={styles.eventGroups}>
          {groupedEvents.map((bucket) => (
            <section key={bucket.key} className={styles.eventGroup}>
              <p className={styles.groupLabel}>{bucket.label}</p>
              <div className={styles.eventList}>
                {bucket.items.map(({ event, index, displayStart, displayEnd }) => {
                  const dateRange = formatDateRange(event, displayStart, displayEnd);
                  const recurrenceSummary = buildCalendarRecurrenceSummary(event);
                  const locationUrl = parseHttpUrl(event.location);
                  const reminderKey = event.uid ?? `${attachment.id}-${index}`;
                  const hasStartTime = Boolean(event.start);
                  const canScheduleReminder = canScheduleReminderForEvent(event);
                  const eventReminder =
                    event.start
                      ? findActiveCalendarReminderForEvent(pendingReminders, {
                          eventUid: event.uid,
                          eventTitle: event.summary || "Calendar event",
                          eventStartAtMs: event.start.getTime()
                        })
                      : null;
                  return (
                    <article key={reminderKey} className={styles.event}>
                      <h5 className={styles.eventTitle}>{event.summary || "Untitled Event"}</h5>
                      {dateRange ? (
                        <div className={styles.metaRow}>
                          <Clock size={12} />
                          <span>{dateRange}</span>
                        </div>
                      ) : null}
                      {event.location ? (
                        <div className={styles.metaRow}>
                          <MapPin size={12} />
                          {locationUrl ? (
                            <a className={styles.locationLink} href={locationUrl} target="_blank" rel="noreferrer">
                              {event.location}
                            </a>
                          ) : (
                            <span>{event.location}</span>
                          )}
                        </div>
                      ) : null}
                      {event.description ? (
                        <div className={styles.description}>
                          <span className={styles.descriptionLabel}>Description</span>
                          <span className={styles.descriptionText}>
                            {linkifyText(event.description, styles.descriptionLink)}
                          </span>
                        </div>
                      ) : null}
                      {event.organizer ? <p className={styles.meta}>Organizer: {event.organizer}</p> : null}
                      {recurrenceSummary ? <p className={styles.meta}>Repeats: {recurrenceSummary}</p> : null}
                      {eventReminder ? (
                        <p className={styles.reminderMeta}>
                          Reminder: {eventReminder.leadLabel} (
                          {formatReminderTrigger(new Date(eventReminder.triggerAtMs))})
                        </p>
                      ) : null}
                      <div className={styles.actions}>
                        <Button
                          size="1"
                          variant="soft"
                          color="indigo"
                          className={styles.reminderButton}
                          onClick={() => openReminderModal(event)}
                          disabled={!canScheduleReminder}
                          title={
                            !hasStartTime
                              ? "No event start time available"
                              : !canScheduleReminder
                                ? "Past events cannot be scheduled"
                                : "Schedule reminder"
                          }
                        >
                          {eventReminder ? <AlarmClock size={14} /> : <AlarmClockPlus size={14} />}
                          {eventReminder ? "Modify Reminder" : "Schedule Reminder"}
                        </Button>
                        {eventReminder ? (
                          <IconButton
                            size="1"
                            variant="soft"
                            color="gray"
                            className={styles.deleteReminderButton}
                            title="Delete reminder"
                            aria-label="Delete reminder"
                            onClick={() => {
                              void removeReminder(event);
                            }}
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
          {events.length > 3 ? (
            <p className={styles.meta}>+{events.length - 3} more events in attachment</p>
          ) : null}
        </div>
      )}
      {reminderNotice ? <p className={styles.notice}>{reminderNotice}</p> : null}
      <Dialog.Root
        open={Boolean(reminderModal)}
        onOpenChange={(open) => {
          if (!open) closeReminderModal();
        }}
      >
        <Dialog.Content size="2" className={styles.reminderDialog}>
          <Flex direction="column" gap="3">
            <Dialog.Title size="4">Schedule Reminder</Dialog.Title>
            <Text size="2" color="gray">
              {reminderModal?.event.summary || "Calendar event"}
            </Text>
            <Flex direction="column" gap="2">
              <Text size="2" weight="medium">
                Notify me
              </Text>
              <Select.Root value={leadOptionValue} onValueChange={setLeadOptionValue}>
                <Select.Trigger />
                <Select.Content position="popper">
                  {CALENDAR_REMINDER_LEAD_OPTIONS.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>
            <Flex justify="end" gap="2">
              <Button variant="soft" color="gray" onClick={closeReminderModal} disabled={savingReminder}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  void scheduleReminder();
                }}
                disabled={
                  savingReminder ||
                  !reminderModal?.event.start ||
                  !canScheduleReminderForEvent(reminderModal.event)
                }
              >
                {savingReminder ? "Saving..." : "Schedule reminder"}
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </section>
  );
}
