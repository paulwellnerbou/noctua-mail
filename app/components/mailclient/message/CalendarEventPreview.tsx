import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import type { Attachment, CalendarEvent, MessageCalendarInviteState } from "@/lib/data";
import {
  parseIcsEvents,
  type CalendarEventPreview as CalendarEventPreviewType
} from "@/lib/calendar";
import {
  collectCalendarInviteMutationGroups,
  inferCalendarInviteMessageActionType
} from "@/lib/calendarInviteProcessing";
import { normalizeCalendarIcsLineEndings } from "@/lib/calendarIcs";
import { isCalendarAttachment } from "@/lib/messageFlags";
import { resolveNextReminderOccurrence } from "@/lib/reminderRecurrence";
import { CALENDAR_REMINDERS_UPDATED_EVENT } from "../utils/calendarReminders";
import { groupItemsByRelativeTime } from "../utils/relativeTimeGroups";
import EventDetailView from "@/app/components/calendar/EventDetailView";
import InviteAttachmentControls from "@/app/components/calendar/InviteAttachmentControls";
import styles from "./CalendarEventPreview.module.css";

function readDataUrl(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex < 0) return "";
  const header = dataUrl.slice(0, commaIndex).toLowerCase();
  const payload = dataUrl.slice(commaIndex + 1);
  if (header.includes(";base64")) {
    try { return atob(payload); } catch { return ""; }
  }
  try { return decodeURIComponent(payload); } catch { return payload; }
}

function toMsArray(values?: Date[]) {
  if (!values || values.length === 0) return undefined;
  const next = values
    .map((v) => v.getTime())
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Math.round(v));
  return next.length > 0 ? next : undefined;
}

function parseAttendees(json?: string) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
    return [];
  } catch {
    return [];
  }
}

function resolveEventDisplayRange(event: CalendarEventPreviewType, nowMs = Date.now()) {
  if (!event.start) return { start: undefined, end: undefined, startAtMs: Number.NaN };
  const startAtMs = event.start.getTime();
  if (!event.recurrenceRule?.trim()) return { start: event.start, end: event.end, startAtMs };
  const next = resolveNextReminderOccurrence({
    eventStartAtMs: startAtMs,
    eventEndAtMs: event.end?.getTime(),
    leadMinutes: 0,
    recurrenceRule: event.recurrenceRule,
    recurrenceDates: toMsArray(event.recurrenceDates),
    excludedDates: toMsArray(event.excludedDates)
  }, nowMs);
  const displayStartAtMs = next?.eventStartAtMs ?? startAtMs;
  const durationMs = event.end ? event.end.getTime() - startAtMs : Number.NaN;
  const hasDuration = Number.isFinite(durationMs) && durationMs > 0;
  return {
    start: new Date(displayStartAtMs),
    end: hasDuration ? new Date(displayStartAtMs + durationMs) : undefined,
    startAtMs: displayStartAtMs
  };
}

export default function CalendarEventPreview({
  attachments,
  accountId,
  sourceMessageRowId,
  inviteStates,
  onFindRelatedByInviteUid,
  readErrorMessage,
  reportError
}: {
  attachments: Attachment[];
  accountId: string;
  sourceMessageRowId?: string;
  inviteStates?: MessageCalendarInviteState[];
  onFindRelatedByInviteUid?: (uid: string) => void;
  readErrorMessage: (res: Response) => Promise<string>;
  reportError: (message: string) => void;
}) {
  const attachment = useMemo(
    () => attachments.find((a) => isCalendarAttachment(a) && Boolean(a.url || a.dataUrl)) ?? null,
    [attachments]
  );

  const [result, setResult] = useState<{
    attachmentId: string;
    events: CalendarEventPreviewType[];
    rawSource: string;
    error: boolean;
  }>({ attachmentId: "", events: [], rawSource: "", error: false });

  const [mountTime] = useState(Date.now);
  const [processingInviteUid, setProcessingInviteUid] = useState<string | null>(null);
  const [inviteStateOverrides, setInviteStateOverrides] = useState<Record<string, boolean>>({});
  const [storedEventsByUid, setStoredEventsByUid] = useState<Record<string, CalendarEvent>>({});

  // Trigger refresh when reminders change (so EventDetailView re-fetches)
  const [reminderVersion, setReminderVersion] = useState(0);

  const handleReminderUpdate = useCallback(() => {
    setReminderVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    window.addEventListener(CALENDAR_REMINDERS_UPDATED_EVENT, handleReminderUpdate);
    return () => window.removeEventListener(CALENDAR_REMINDERS_UPDATED_EVENT, handleReminderUpdate);
  }, [handleReminderUpdate]);

  useEffect(() => {
    let active = true;
    if (!attachment) return;
    const load = async () => {
      try {
        const source = attachment.dataUrl
          ? readDataUrl(attachment.dataUrl)
          : attachment.url
            ? await fetch(attachment.url).then((r) => (r.ok ? r.text() : ""))
            : "";
        if (!active) return;
        const parsed = parseIcsEvents(source);
        setResult({ attachmentId: attachment.id, events: parsed, rawSource: source, error: parsed.length === 0 });
      } catch {
        if (!active) return;
        setResult({ attachmentId: attachment.id, events: [], rawSource: "", error: true });
      }
    };
    void load();
    return () => { active = false; };
  }, [attachment]);

  useEffect(() => {
    setInviteStateOverrides({});
    setProcessingInviteUid(null);
    setStoredEventsByUid({});
  }, [sourceMessageRowId, attachment?.id]);

  const hasCurrentResult = Boolean(attachment && result.attachmentId === attachment.id);
  const events = useMemo(
    () => (hasCurrentResult ? result.events : []),
    [hasCurrentResult, result.events]
  );
  const rawSource = hasCurrentResult ? result.rawSource : "";
  const normalizedRawSource = normalizeCalendarIcsLineEndings(rawSource);
  const rawIcsUid = events.find((e) => (e.uid ?? "").trim().length > 0)?.uid?.trim();
  const relatedInviteUid = rawIcsUid?.trim() ?? "";

  const groupedEvents = useMemo(() => {
    const nowMs = mountTime;
    const sourceEvents = (hasCurrentResult ? result.events : []).slice(0, 3);
    const entries = sourceEvents.map((event, index) => {
      const displayRange = resolveEventDisplayRange(event, nowMs);
      return { event, index, displayStart: displayRange.start, displayEnd: displayRange.end, displayStartAtMs: displayRange.startAtMs };
    });
    return groupItemsByRelativeTime(entries, (e) => e.displayStartAtMs, nowMs);
  }, [hasCurrentResult, result.events, mountTime]);

  const inviteActionTypeByUid = useMemo(() => {
    const map = new Map<string, ReturnType<typeof inferCalendarInviteMessageActionType>>();
    if (!rawSource.trim()) return map;
    collectCalendarInviteMutationGroups(rawSource).forEach((group) => {
      map.set(group.eventUid.trim().toLowerCase(), inferCalendarInviteMessageActionType(group));
    });
    return map;
  }, [rawSource]);

  const inviteStateByUid = useMemo(() => {
    const map = new Map<string, MessageCalendarInviteState>();
    (inviteStates ?? []).forEach((state) => {
      const eventUid = state.eventUid?.trim().toLowerCase();
      if (!eventUid) return;
      map.set(eventUid, state);
    });
    return map;
  }, [inviteStates]);

  const eventUids = useMemo(
    () =>
      Array.from(
        new Set(
          events
            .map((event) => event.uid?.trim())
            .filter((value): value is string => Boolean(value))
        )
      ),
    [events]
  );

  const refreshStoredEvents = useCallback(async () => {
    if (!accountId.trim()) return;
    if (eventUids.length === 0) {
      setStoredEventsByUid({});
      return;
    }
    try {
      const responses = await Promise.all(
        eventUids.map(async (eventUid) => {
          const params = new URLSearchParams({
            accountId,
            eventUid
          });
          const res = await fetch(`/api/calendar/events?${params.toString()}`, { cache: "no-store" });
          if (!res.ok) return null;
          const payload = (await res.json()) as { event?: CalendarEvent | null };
          return payload.event ? [eventUid.trim().toLowerCase(), payload.event] as const : null;
        })
      );
      const next: Record<string, CalendarEvent> = {};
      responses.forEach((entry) => {
        if (!entry) return;
        next[entry[0]] = entry[1];
      });
      setStoredEventsByUid(next);
    } catch {
      // ignore
    }
  }, [accountId, eventUids]);

  useEffect(() => {
    void refreshStoredEvents();
  }, [refreshStoredEvents]);

  const handleProcessInvite = useCallback(
    async (eventUid?: string) => {
      if (!accountId.trim() || !sourceMessageRowId?.trim() || !rawSource.trim()) return;
      const normalizedEventUid = eventUid?.trim().toLowerCase() ?? "";
      setProcessingInviteUid(normalizedEventUid || "__all__");
      try {
        const res = await fetch("/api/calendar/invites/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId,
            messageId: sourceMessageRowId,
            icsSource: rawSource
          })
        });
        if (!res.ok) {
          reportError(await readErrorMessage(res));
          return;
        }
        const payload = (await res.json()) as {
          states?: Array<{ eventUid?: string; processed?: boolean }>;
        };
        const nextOverrides: Record<string, boolean> = {};
        (payload.states ?? []).forEach((state) => {
          const uid = state.eventUid?.trim().toLowerCase();
          if (!uid) return;
          nextOverrides[uid] = Boolean(state.processed);
        });
        setInviteStateOverrides((prev) => ({ ...prev, ...nextOverrides }));
        await refreshStoredEvents();
        window.dispatchEvent(new Event(CALENDAR_REMINDERS_UPDATED_EVENT));
      } catch (error) {
        reportError(error instanceof Error ? error.message : "Failed to process calendar invite.");
      } finally {
        setProcessingInviteUid(null);
      }
    },
    [accountId, rawSource, readErrorMessage, refreshStoredEvents, reportError, sourceMessageRowId]
  );

  const loading = !hasCurrentResult;
  const hasError = hasCurrentResult && result.error;

  if (!attachment) return null;

  const downloadFilename = (() => {
    const name = attachment.filename || "invite.ics";
    return name.toLowerCase().endsWith(".ics") ? name : `${name}.ics`;
  })();

  return (
    <section className={styles.preview}>
      <div className={styles.header}>
        <div className={styles.title}>
          <CalendarDays size={14} />
          <span>Calendar Event</span>
        </div>
        <InviteAttachmentControls
          downloadLabel={downloadFilename}
          downloadFilename={downloadFilename}
          downloadHref={attachment.url ?? attachment.dataUrl ?? undefined}
          rawIcsSource={normalizedRawSource}
          relatedInviteUid={relatedInviteUid}
          onFindRelatedByInviteUid={onFindRelatedByInviteUid}
        />
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
                  const reminderKey = event.uid ?? `${attachment.id}-${index}`;
                  const storedEvent = event.uid?.trim()
                    ? storedEventsByUid[event.uid.trim().toLowerCase()]
                    : undefined;
                  const inviteActionType = (() => {
                    const eventUid = event.uid?.trim().toLowerCase() ?? "";
                    if (!eventUid) return undefined;
                    const state = inviteStateByUid.get(eventUid);
                    return inviteActionTypeByUid.get(eventUid) ?? state?.actionType ?? "invitation";
                  })();
                  const forceOccurrenceResponse = Boolean(
                    event.recurrenceId &&
                    (inviteActionType === "update" || inviteActionType === "cancellation")
                  );
                  return (
                    <EventDetailView
                      key={`${reminderKey}-${reminderVersion}`}
                      accountId={accountId}
                      eventUid={event.uid}
                      title={event.summary || "Untitled Event"}
                      startMs={displayStart?.getTime()}
                      endMs={displayEnd?.getTime()}
                      allDay={event.allDay}
                      startTimezone={event.startTimezone}
                      endTimezone={event.endTimezone}
                      location={event.location}
                      description={event.description}
                      organizer={event.organizer}
                      attendees={parseAttendees(storedEvent?.attendees)}
                      recurrenceRule={event.recurrenceRule}
                      recurrenceDates={toMsArray(event.recurrenceDates)}
                      excludedDates={toMsArray(event.excludedDates)}
                      status={event.status}
                      myPartstat={storedEvent?.myPartstat}
                      replyRequested={storedEvent?.replyRequested}
                      canRespond={Boolean(storedEvent?.rawIcs && storedEvent?.myAttendeeEmail)}
                      sourceType={storedEvent?.sourceType}
                      messageId={sourceMessageRowId}
                      eventId={storedEvent?.id}
                      eventStartAtMs={event.start?.getTime()}
                      eventEndAtMs={event.end?.getTime()}
                      onEventUpdated={(updatedEvent) => {
                        const normalizedUid = updatedEvent.eventUid.trim().toLowerCase();
                        setStoredEventsByUid((prev) => ({ ...prev, [normalizedUid]: updatedEvent }));
                      }}
                      onInviteProcessed={(processedEventUid) => {
                        const normalizedUid = processedEventUid.trim().toLowerCase();
                        if (!normalizedUid) return;
                        setInviteStateOverrides((prev) => ({ ...prev, [normalizedUid]: true }));
                      }}
                      responseOccurrenceLabel={forceOccurrenceResponse ? "This occurrence" : "Next occurrence"}
                      forceOccurrenceResponse={forceOccurrenceResponse}
                      inviteProcessing={(() => {
                        const eventUid = event.uid?.trim().toLowerCase() ?? "";
                        if (!eventUid) return undefined;
                        return {
                          actionType: inviteActionType,
                          processed:
                            inviteStateOverrides[eventUid] ??
                            Boolean(inviteStateByUid.get(eventUid)?.processedAtMs),
                          processing: processingInviteUid === eventUid || processingInviteUid === "__all__",
                          onProcess: () => handleProcessInvite(event.uid)
                        };
                      })()}
                    />
                  );
                })}
              </div>
            </section>
          ))}
          {events.length > 3 && (
            <p className={styles.meta}>+{events.length - 3} more events in attachment</p>
          )}
        </div>
      )}
    </section>
  );
}
