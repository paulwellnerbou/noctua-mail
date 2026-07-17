import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import type {
  Attachment,
  CalendarEvent,
  MessageCalendarInviteState
} from "@/lib/data";
import {
  parseIcsEvents,
  type CalendarEventPreview as CalendarEventPreviewType
} from "@/lib/calendar";
import {
  collectCalendarInviteMutationGroups,
  inferCalendarInviteMessageActionType,
  type CalendarInviteMutationGroup,
  type CalendarInviteUnprocessedReason
} from "@/lib/calendarInviteProcessing";
import { getCalendarInviteScopeInfo } from "@/lib/calendarInviteScope";
import {
  buildAccountCalendarEventsPath,
  buildAccountCalendarInvitesProcessPath
} from "@/lib/accountApiPaths";
import { normalizeCalendarIcsLineEndings } from "@/lib/calendarIcs";
import { isCalendarAttachment } from "@/lib/messageFlags";
import { resolveNextReminderOccurrence } from "@/lib/reminderRecurrence";
import {
  CALENDAR_REMINDERS_UPDATED_EVENT,
  dispatchCalendarRemindersUpdatedEvent
} from "../utils/calendarReminders";
import { groupItemsByRelativeTime } from "../utils/relativeTimeGroups";
import type { InviteProcessingStatePatch } from "../utils/calendarInviteState";
import EventDetailView from "@/app/components/calendar/EventDetailView";
import InviteAttachmentControls from "@/app/components/calendar/InviteAttachmentControls";
import CalendarEventDiffPanel from "./CalendarEventDiffPanel";
import shellStyles from "../../calendar/EmbeddedPreviewShell.module.css";
import styles from "./CalendarEventPreview.module.css";

type InviteProcessingOverride = {
  processed: boolean;
  processedAtMs?: number;
  processedAutomatically?: boolean;
  unprocessedReason?: CalendarInviteUnprocessedReason;
};

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
  onInviteStateChange,
  readErrorMessage,
  reportError
}: {
  attachments: Attachment[];
  accountId: string;
  sourceMessageRowId?: string;
  inviteStates?: MessageCalendarInviteState[];
  onFindRelatedByInviteUid?: (uid: string) => void;
  onInviteStateChange?: (patches: InviteProcessingStatePatch[]) => void;
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
  const [inviteStateOverrides, setInviteStateOverrides] = useState<Record<string, InviteProcessingOverride>>({});
  const [storedEventsByUid, setStoredEventsByUid] = useState<Record<string, CalendarEvent>>({});
  const [storedEventsLoaded, setStoredEventsLoaded] = useState(false);

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

  const inviteMutationGroupByUid = useMemo(() => {
    const map = new Map<string, CalendarInviteMutationGroup>();
    if (!rawSource.trim()) return map;
    collectCalendarInviteMutationGroups(rawSource).forEach((group) => {
      map.set(group.eventUid.trim().toLowerCase(), group);
    });
    return map;
  }, [rawSource]);

  const inviteActionTypeByUid = useMemo(() => {
    const map = new Map<string, ReturnType<typeof inferCalendarInviteMessageActionType>>();
    inviteMutationGroupByUid.forEach((group, uid) => {
      map.set(uid, inferCalendarInviteMessageActionType(group));
    });
    return map;
  }, [inviteMutationGroupByUid]);

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
    setStoredEventsLoaded(false);
    if (!accountId.trim()) {
      setStoredEventsByUid({});
      setStoredEventsLoaded(true);
      return;
    }
    if (eventUids.length === 0) {
      setStoredEventsByUid({});
      setStoredEventsLoaded(true);
      return;
    }
    try {
      const responses = await Promise.all(
        eventUids.map(async (eventUid) => {
          const params = new URLSearchParams({ eventUid });
          const res = await fetch(buildAccountCalendarEventsPath(accountId, params), { cache: "no-store" });
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
    } finally {
      setStoredEventsLoaded(true);
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
        const res = await fetch(buildAccountCalendarInvitesProcessPath(accountId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId: sourceMessageRowId,
            icsSource: rawSource
          })
        });
        if (!res.ok) {
          reportError(await readErrorMessage(res));
          return;
        }
        const payload = (await res.json()) as {
          states?: Array<{
            eventUid?: string;
            actionType?: MessageCalendarInviteState["actionType"];
            processed?: boolean;
            processedAtMs?: number;
            processedAutomatically?: boolean;
            unprocessedReason?: CalendarInviteUnprocessedReason;
          }>;
        };
        const nextOverrides: Record<string, InviteProcessingOverride> = {};
        (payload.states ?? []).forEach((state) => {
          const uid = state.eventUid?.trim().toLowerCase();
          if (!uid) return;
          nextOverrides[uid] = {
            processed: Boolean(state.processed),
            processedAtMs:
              typeof state.processedAtMs === "number" && Number.isFinite(state.processedAtMs)
                ? state.processedAtMs
                : undefined,
            processedAutomatically:
              typeof state.processedAutomatically === "boolean"
                ? state.processedAutomatically
                : undefined,
            unprocessedReason: state.unprocessedReason
          };
        });
        const statePatches = (payload.states ?? [])
          .flatMap((state): InviteProcessingStatePatch[] => {
            const uid = state.eventUid?.trim();
            const normalizedUid = uid?.toLowerCase() ?? "";
            if (!uid) return [];
            const actionType =
              state.actionType ??
              inviteActionTypeByUid.get(normalizedUid) ??
              inviteStateByUid.get(normalizedUid)?.actionType;
            if (!Boolean(state.processed) && !state.unprocessedReason) return [];
            return [{
              eventUid: uid,
              actionType,
              processed: Boolean(state.processed),
              processedAtMs:
                Boolean(state.processed) &&
                typeof state.processedAtMs === "number" &&
                Number.isFinite(state.processedAtMs)
                  ? state.processedAtMs
                  : undefined,
              processedAutomatically:
                Boolean(state.processed) && typeof state.processedAutomatically === "boolean"
                  ? state.processedAutomatically
                  : undefined,
              unprocessedReason: !Boolean(state.processed) ? state.unprocessedReason : undefined
            }];
          });
        setInviteStateOverrides((prev) => ({ ...prev, ...nextOverrides }));
        if (statePatches.length > 0) {
          onInviteStateChange?.(statePatches);
        }
        await refreshStoredEvents();
        dispatchCalendarRemindersUpdatedEvent();
      } catch (error) {
        reportError(error instanceof Error ? error.message : "Failed to process calendar invite.");
      } finally {
        setProcessingInviteUid(null);
      }
    },
    [
      accountId,
      inviteActionTypeByUid,
      inviteStateByUid,
      onInviteStateChange,
      rawSource,
      readErrorMessage,
      refreshStoredEvents,
      reportError,
      sourceMessageRowId
    ]
  );

  const loading = !hasCurrentResult;
  const hasError = hasCurrentResult && result.error;

  if (!attachment) return null;

  const downloadFilename = (() => {
    const name = attachment.filename || "invite.ics";
    return name.toLowerCase().endsWith(".ics") ? name : `${name}.ics`;
  })();

  return (
    <section className={shellStyles.preview}>
      <div className={shellStyles.header}>
        <div className={shellStyles.title}>
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
                  const mutationGroup =
                    inviteMutationGroupByUid.get(event.uid?.trim().toLowerCase() ?? "") ?? null;
                  const inviteScopeLabel = getCalendarInviteScopeInfo({
                    event,
                    mutationGroup,
                    storedEvent
                  }).label;
                  const showDiffPanel =
                    Boolean(sourceMessageRowId) &&
                    Boolean(event.uid?.trim()) &&
                    (inviteActionType === "update" || inviteActionType === "cancellation");
                  return (
                    <div
                      key={`${reminderKey}-${reminderVersion}-wrapper`}
                      className={styles.eventList}
                    >
                      {showDiffPanel ? (
                        <CalendarEventDiffPanel
                          accountId={accountId}
                          messageId={sourceMessageRowId!}
                          eventUid={event.uid!.trim()}
                        />
                      ) : null}
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
                      eventSnapshot={storedEvent ?? undefined}
                      eventStartAtMs={event.start?.getTime()}
                      eventEndAtMs={event.end?.getTime()}
                      onEventUpdated={(updatedEvent) => {
                        const normalizedUid = updatedEvent.eventUid.trim().toLowerCase();
                        setStoredEventsByUid((prev) => ({ ...prev, [normalizedUid]: updatedEvent }));
                      }}
                      onEventDeleted={() => {
                        // Soft-deleted events drop out of the refetch, reverting
                        // the card to its unstored state; Reprocess re-adds them.
                        void refreshStoredEvents();
                      }}
                      onInviteProcessed={(processedEventUid, processedState) => {
                        const normalizedUid = processedEventUid.trim().toLowerCase();
                        if (!normalizedUid) return;
                        const actionType =
                          inviteActionType ?? inviteStateByUid.get(normalizedUid)?.actionType;
                        setInviteStateOverrides((prev) => ({
                          ...prev,
                          [normalizedUid]: {
                            processed: true,
                            processedAtMs: processedState?.processedAtMs,
                            processedAutomatically: processedState?.processedAutomatically,
                            unprocessedReason: undefined
                          }
                        }));
                        onInviteStateChange?.([
                          {
                            eventUid: processedEventUid,
                            actionType,
                            processed: true,
                            processedAtMs: processedState?.processedAtMs,
                            processedAutomatically: processedState?.processedAutomatically
                          }
                        ]);
                      }}
                      responseOccurrenceLabel={forceOccurrenceResponse ? "This occurrence" : "Next occurrence"}
                      forceOccurrenceResponse={forceOccurrenceResponse}
                      inviteScopeLabel={inviteScopeLabel}
                      showEmailSnapshot={false}
                      inviteProcessing={(() => {
                        const eventUid = event.uid?.trim().toLowerCase() ?? "";
                        if (!eventUid) return undefined;
                        const inviteState = inviteStateByUid.get(eventUid);
                        const inviteStateOverride = inviteStateOverrides[eventUid];
                        const processed =
                          inviteStateOverride?.processed ?? Boolean(inviteState?.processedAtMs);
                        const derivedUnprocessedReason: CalendarInviteUnprocessedReason | undefined =
                          !processed &&
                          storedEventsLoaded &&
                          !storedEvent &&
                          mutationGroup?.hasInstanceChanges &&
                          !mutationGroup.baseEvent
                            ? "event_series_not_found"
                            : undefined;
                        return {
                          actionType: inviteActionType ?? "invitation",
                          processed,
                          processedAtMs:
                            inviteStateOverride?.processedAtMs ?? inviteState?.processedAtMs,
                          processedAutomatically:
                            inviteStateOverride?.processedAutomatically ?? inviteState?.processedAutomatically,
                          unprocessedReason:
                            inviteStateOverride?.unprocessedReason ??
                            inviteState?.unprocessedReason ??
                            derivedUnprocessedReason,
                          processing: processingInviteUid === eventUid || processingInviteUid === "__all__",
                          onProcess: () => handleProcessInvite(event.uid)
                        };
                      })()}
                    />
                    </div>
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
