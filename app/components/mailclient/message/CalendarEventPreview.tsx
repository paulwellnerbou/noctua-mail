import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Search, Info } from "lucide-react";
import { Badge, Button, Dialog, Flex, Text } from "@radix-ui/themes";
import type { Attachment, MessageCalendarInviteState } from "@/lib/data";
import {
  parseIcsEvents,
  type CalendarEventPreview as CalendarEventPreviewType
} from "@/lib/calendar";
import {
  collectCalendarInviteMutationGroups,
  inferCalendarInviteActionType
} from "@/lib/calendarInviteProcessing";
import { isCalendarAttachment } from "@/lib/messageFlags";
import { resolveNextReminderOccurrence } from "@/lib/reminderRecurrence";
import { CALENDAR_REMINDERS_UPDATED_EVENT } from "../utils/calendarReminders";
import { groupItemsByRelativeTime } from "../utils/relativeTimeGroups";
import DialogTitleBar from "./DialogTitleBar";
import RawTextPanel from "./RawTextPanel";
import EventDetailView from "@/app/components/calendar/EventDetailView";
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

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function extractIcsUid(rawSource: string) {
  if (!rawSource) return "";
  const unfolded = normalizeLineEndings(rawSource).replace(/\n[ \t]/g, "");
  for (const line of unfolded.split("\n")) {
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim().toUpperCase();
    if (key !== "UID" && !key.startsWith("UID;")) continue;
    const uid = line.slice(sep + 1).trim();
    if (uid) return uid;
  }
  return "";
}

function toMsArray(values?: Date[]) {
  if (!values || values.length === 0) return undefined;
  const next = values
    .map((v) => v.getTime())
    .filter((v) => Number.isFinite(v) && v > 0)
    .map((v) => Math.round(v));
  return next.length > 0 ? next : undefined;
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
  onFindRelatedByInviteUid
}: {
  attachments: Attachment[];
  accountId: string;
  sourceMessageRowId?: string;
  inviteStates?: MessageCalendarInviteState[];
  onFindRelatedByInviteUid?: (uid: string) => void;
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

  const [rawIcsOpen, setRawIcsOpen] = useState(false);
  const [mountTime] = useState(Date.now);
  const [processingInviteUid, setProcessingInviteUid] = useState<string | null>(null);
  const [inviteStateOverrides, setInviteStateOverrides] = useState<Record<string, boolean>>({});

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
  }, [sourceMessageRowId, attachment?.id]);

  const hasCurrentResult = Boolean(attachment && result.attachmentId === attachment.id);
  const events = hasCurrentResult ? result.events : [];
  const rawSource = hasCurrentResult ? result.rawSource : "";
  const normalizedRawSource = normalizeLineEndings(rawSource);
  const canViewRawIcs = normalizedRawSource.trim().length > 0;
  const rawIcsUid =
    events.find((e) => (e.uid ?? "").trim().length > 0)?.uid?.trim() ??
    extractIcsUid(normalizedRawSource);
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
    const map = new Map<string, ReturnType<typeof inferCalendarInviteActionType>>();
    if (!rawSource.trim()) return map;
    collectCalendarInviteMutationGroups(rawSource).forEach((group) => {
      map.set(group.eventUid.trim().toLowerCase(), inferCalendarInviteActionType(group));
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
          throw new Error(`process invite failed (${res.status})`);
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
        window.dispatchEvent(new Event(CALENDAR_REMINDERS_UPDATED_EVENT));
      } catch {
        // ignore; preview keeps existing state
      } finally {
        setProcessingInviteUid(null);
      }
    },
    [accountId, rawSource, sourceMessageRowId]
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
        <Flex align="center" gap="2" className={styles.attachmentControls}>
          <a
            className={styles.attachmentLink}
            href={attachment.url ?? attachment.dataUrl ?? "#"}
            onClick={(e) => { if (!attachment.url && !attachment.dataUrl) e.preventDefault(); }}
          >
            <Badge size="1" variant="soft" color="indigo" className={styles.attachmentBadge}>
              {downloadFilename}
            </Badge>
          </a>
          <Dialog.Root open={rawIcsOpen} onOpenChange={setRawIcsOpen}>
            <Button
              size="1"
              variant="soft"
              color="gray"
              className={styles.infoButton}
              title="Find related"
              aria-label="Find related"
              disabled={!relatedInviteUid || !onFindRelatedByInviteUid}
              onClick={() => { if (relatedInviteUid) onFindRelatedByInviteUid?.(relatedInviteUid); }}
            >
              <Search size={12} />
            </Button>
            <Button
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
            </Button>
            <Dialog.Content size="4" className={styles.rawIcsDialog}>
              <Flex direction="column" gap="3">
                <DialogTitleBar title="Raw ICS Content" onClose={() => setRawIcsOpen(false)} />
                <Text size="2" color="gray">{downloadFilename}</Text>
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
                  const reminderKey = event.uid ?? `${attachment.id}-${index}`;
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
                      recurrenceRule={event.recurrenceRule}
                      recurrenceDates={toMsArray(event.recurrenceDates)}
                      excludedDates={toMsArray(event.excludedDates)}
                      status={event.status}
                      messageId={sourceMessageRowId}
                      eventStartAtMs={event.start?.getTime()}
                      eventEndAtMs={event.end?.getTime()}
                      inviteProcessing={(() => {
                        const eventUid = event.uid?.trim().toLowerCase() ?? "";
                        if (!eventUid) return undefined;
                        const state = inviteStateByUid.get(eventUid);
                        return {
                          actionType:
                            state?.actionType ?? inviteActionTypeByUid.get(eventUid) ?? "invitation",
                          processed:
                            inviteStateOverrides[eventUid] ??
                            Boolean(state?.processedAtMs),
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
