"use client";

import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import type { CalendarEvent, CalendarReminder } from "@/lib/data";
import { buildCalendarIcsFilename } from "@/lib/calendarIcs";
import InviteAttachmentControls from "./InviteAttachmentControls";
import EventDetailView from "./EventDetailView";
import styles from "./EventDetailPanel.module.css";

type Props = {
  event: CalendarEvent | CalendarReminder;
  kind: "event" | "reminder";
  accountId: string;
  occurrenceStartAtMs?: number;
  onBack: () => void;
  onOpenMessage?: (messageId: string) => void;
  onFindRelatedByInviteUid?: (uid: string) => void;
  onEventUpdated?: (event: CalendarEvent) => void;
  onEventDeleted?: (event: CalendarEvent) => void;
};

function parseAttendees(json?: string): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
    return [];
  } catch {
    return [];
  }
}

export default function EventDetailPanel({
  event,
  kind,
  accountId,
  occurrenceStartAtMs,
  onBack,
  onOpenMessage,
  onFindRelatedByInviteUid,
  onEventUpdated,
  onEventDeleted
}: Props) {
  const isCalEvent = kind === "event";
  const calEv = isCalEvent ? (event as CalendarEvent) : null;
  const reminder = !isCalEvent ? (event as CalendarReminder) : null;

  const startMs = calEv
    ? calEv.startAtMs
    : (reminder ? (reminder.nextEventStartAtMs ?? reminder.eventStartAtMs) : undefined);
  const endMs = calEv
    ? calEv.endAtMs
    : (() => {
        if (!reminder?.eventEndAtMs || !reminder.eventStartAtMs) return undefined;
        const dur = reminder.eventEndAtMs - reminder.eventStartAtMs;
        return (startMs ?? 0) + dur;
      })();

  const inviteControls = useMemo(() => {
    const eventUid = calEv?.eventUid ?? reminder?.eventUid;
    const rawIcsSource = calEv?.rawIcs;
    if (!eventUid && !rawIcsSource) return null;
    const filename = buildCalendarIcsFilename(eventUid);
    return (
      <InviteAttachmentControls
        downloadLabel={filename}
        downloadFilename={filename}
        rawIcsSource={rawIcsSource}
        relatedInviteUid={eventUid}
        onFindRelatedByInviteUid={onFindRelatedByInviteUid}
      />
    );
  }, [calEv?.eventUid, calEv?.rawIcs, onFindRelatedByInviteUid, reminder?.eventUid]);

  return (
    <div className={styles.panel}>
      <div className={styles.subheader}>
        <button className={styles.backButton} onClick={onBack} aria-label="Back to calendar">
          <ArrowLeft size={13} />
          Back
        </button>
        <div className={styles.subheaderActions}>
          {inviteControls}
        </div>
      </div>
      <div className={styles.body}>
        <EventDetailView
          accountId={accountId}
          eventUid={calEv?.eventUid ?? reminder?.eventUid}
          title={calEv ? calEv.summary : (reminder?.eventTitle ?? "")}
          startMs={startMs}
          endMs={endMs}
          allDay={calEv?.allDay ?? false}
          startTimezone={calEv?.startTimezone ?? reminder?.startTimezone}
          endTimezone={calEv?.endTimezone}
          location={calEv?.location ?? reminder?.eventLocation}
          description={calEv?.description ?? reminder?.eventDescription}
          organizer={calEv?.organizer}
          attendees={parseAttendees(calEv?.attendees)}
          recurrenceRule={calEv?.recurrenceRule ?? reminder?.recurrenceRule}
          recurrenceDates={calEv?.recurrenceDates ?? reminder?.recurrenceDates}
          excludedDates={calEv?.excludedDates ?? reminder?.excludedDates}
          status={calEv?.status}
          myPartstat={calEv?.myPartstat}
          replyRequested={calEv?.replyRequested}
          canRespond={Boolean(calEv?.rawIcs && calEv?.myAttendeeEmail)}
          sourceType={calEv?.sourceType}
          messageId={calEv?.messageId ?? reminder?.messageId}
          occurrenceMessageId={
            occurrenceStartAtMs != null && calEv?.occurrenceMessageIds
              ? calEv.occurrenceMessageIds[String(occurrenceStartAtMs)]
              : undefined
          }
          eventId={calEv?.id}
          eventStartAtMs={calEv?.startAtMs ?? reminder?.eventStartAtMs}
          eventEndAtMs={calEv?.endAtMs ?? reminder?.eventEndAtMs}
          onOpenMessage={onOpenMessage}
          onEventUpdated={onEventUpdated}
          onEventDeleted={calEv && onEventDeleted ? () => onEventDeleted(calEv) : undefined}
          responseOccurrenceLabel="This occurrence"
        />
      </div>
    </div>
  );
}
