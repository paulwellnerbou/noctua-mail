"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import rrulePlugin from "@fullcalendar/rrule";
import type { EventClickArg, EventMountArg, DatesSetArg, EventInput } from "@fullcalendar/core";
import { formatCalendarEventRange } from "@/lib/calendar";
import type { AccountDateFormat, CalendarEvent } from "@/lib/data";
import type { CalendarReminder } from "@/lib/data";
import { useAccountDateFormat } from "@/app/components/AccountDateFormatContext";
import {
  buildAccountCalendarEventsPath,
  buildAccountRemindersPath
} from "@/lib/accountApiPaths";
import {
  expandCalendarEventForRange,
  filterCalendarReminderDuplicates
} from "@/lib/calendarOccurrences";
import { CALENDAR_REMINDERS_UPDATED_EVENT } from "@/app/components/mailclient/utils/calendarReminders";
import { CALENDAR_EVENTS_UPDATED_EVENT } from "./calendarEventsClient";
import "./fullcalendar-theme.css";

export type CalendarViewHandle = {
  goToDate: (date: Date) => void;
  goToToday: () => void;
};

type Props = {
  accountId: string;
  compact?: boolean;
  firstDay?: 0 | 1;
  onEventClick?: (
    event: CalendarEvent | CalendarReminder,
    kind: "event" | "reminder",
    occurrenceStartAtMs?: number
  ) => void;
  onDateClick?: (date: Date, allDay: boolean) => void;
  /** Opens the new-event dialog (wired to the toolbar "＋ Event" button). */
  onCreateEvent?: () => void;
  calendarRef?: React.RefObject<FullCalendar | null>;
};

function calendarEventToFcEvent(
  ev: CalendarEvent,
  displayStartAtMs = ev.startAtMs,
  displayEndAtMs = ev.endAtMs
): EventInput {
  // FullCalendar's event parser discards `end <= start` and then falls
  // back to `defaultTimedEventDuration` (1h by default), so a true
  // zero-duration "point in time" event (DTSTART == DTEND) gets rendered
  // as a full hour. Pad by 1ms so FC keeps the end; eventMinHeight (10)
  // then clamps the visual to a thin marker, and the hover tooltip
  // reads the real end from extendedProps so the displayed range stays
  // truthful.
  const fcEnd =
    typeof displayEndAtMs === "number"
      ? new Date(displayEndAtMs <= displayStartAtMs ? displayStartAtMs + 1 : displayEndAtMs)
      : undefined;
  return {
    id: ev.recurrenceRule?.trim() ? `${ev.id}-${displayStartAtMs}` : ev.id,
    title: ev.summary,
    start: new Date(displayStartAtMs),
    end: fcEnd,
    allDay: ev.allDay,
    classNames: [
      `fc-event-${ev.sourceType}`,
      ...(ev.myPartstat ? [`fc-event-partstat-${ev.myPartstat.toLowerCase().replace(/-/g, "")}`] : [])
    ],
    extendedProps: { kind: "event", data: ev, displayStartAtMs, displayEndAtMs }
  };
}

function reminderToFcEvent(r: CalendarReminder): EventInput {
  const startMs = r.nextEventStartAtMs ?? r.eventStartAtMs;
  return {
    id: `reminder-${r.id}`,
    title: `🔔 ${r.eventTitle}`,
    start: new Date(startMs),
    end: r.eventEndAtMs ? new Date(startMs + (r.eventEndAtMs - r.eventStartAtMs)) : undefined,
    allDay: false,
    classNames: ["fc-event-reminder"],
    extendedProps: { kind: "reminder", data: r }
  };
}

const CALENDAR_VIEW_KEY = "noctua:calendarView";
// sessionStorage so reopening the app starts at today, while navigating
// away (event detail unmounts FullCalendar) and back restores the spot.
const CALENDAR_DATE_KEY = "noctua:calendarDate";
const ALLOWED_VIEWS = ["dayGridMonth", "timeGridWeek", "timeGridDay"];

function getSavedView(): string {
  try {
    const v = localStorage.getItem(CALENDAR_VIEW_KEY);
    if (v && ALLOWED_VIEWS.includes(v)) return v;
  } catch {}
  return "dayGridMonth";
}

function getSavedDate(): Date | undefined {
  try {
    const v = sessionStorage.getItem(CALENDAR_DATE_KEY);
    if (v) {
      const ms = Date.parse(v);
      if (!Number.isNaN(ms)) return new Date(ms);
    }
  } catch {}
  return undefined;
}

function buildEventHoverTitle(arg: EventMountArg, dateFormat?: AccountDateFormat) {
  const props = arg.event.extendedProps as {
    kind: "event" | "reminder";
    data: CalendarEvent | CalendarReminder;
    displayEndAtMs?: number;
  };
  const lines = [arg.event.title.trim() || "Calendar event"];

  // Prefer the real end stored in extendedProps over arg.event.end:
  // we synthetically pad zero-duration events by 1ms so FullCalendar
  // doesn't drop the end and render a 1h fallback, but the tooltip
  // should still show the truthful range.
  const realEnd =
    typeof props.displayEndAtMs === "number"
      ? new Date(props.displayEndAtMs)
      : (arg.event.end ?? undefined);

  if (props.kind === "event") {
    const event = props.data as CalendarEvent;
    const rangeLabel = formatCalendarEventRange(arg.event.start ?? undefined, realEnd, {
      allDay: event.allDay,
      startTimeZone: event.startTimezone,
      endTimeZone: event.endTimezone,
      dateFormat
    });
    if (rangeLabel) lines.push(rangeLabel);
    if (event.location?.trim()) lines.push(event.location.trim());
  } else {
    const reminder = props.data as CalendarReminder;
    const rangeLabel = formatCalendarEventRange(arg.event.start ?? undefined, realEnd, {
      startTimeZone: reminder.startTimezone,
      dateFormat
    });
    if (rangeLabel) lines.push(rangeLabel);
    if (reminder.eventLocation?.trim()) lines.push(reminder.eventLocation.trim());
  }

  return lines.join("\n");
}

export default function CalendarView({
  accountId,
  compact = false,
  firstDay = 1,
  onEventClick,
  onDateClick,
  onCreateEvent,
  calendarRef: externalRef
}: Props) {
  const dateFormat = useAccountDateFormat();
  const internalRef = useRef<FullCalendar>(null);
  const calendarRef = (externalRef ?? internalRef) as React.RefObject<FullCalendar>;
  const [fullCalendarEvents, setFullCalendarEvents] = useState<EventInput[]>([]);
  const fetchRangeRef = useRef<{ startMs: number; endMs: number } | null>(null);
  const fetchRequestIdRef = useRef(0);
  const previousAccountIdRef = useRef<string | null>(null);
  const [initialView] = useState<string>(getSavedView);
  const [initialDate] = useState<Date | undefined>(() =>
    compact ? undefined : getSavedDate()
  );

  const fetchEvents = useCallback(
    async (startMs: number, endMs: number) => {
      if (!accountId) return;
      const requestId = fetchRequestIdRef.current + 1;
      fetchRequestIdRef.current = requestId;
      try {
        const params = new URLSearchParams({
          startMs: String(startMs),
          endMs: String(endMs)
        });
        const [eventsRes, remindersRes] = await Promise.all([
          fetch(buildAccountCalendarEventsPath(accountId, params)),
          fetch(buildAccountRemindersPath(accountId))
        ]);

        const eventsData = eventsRes.ok
          ? ((await eventsRes.json()) as { items?: CalendarEvent[] })
          : { items: [] };
        const remindersData = remindersRes.ok
          ? ((await remindersRes.json()) as { items?: CalendarReminder[] })
          : { items: [] };

        const visibleEvents = (eventsData.items ?? []).flatMap((event) =>
          expandCalendarEventForRange(event, startMs, endMs)
        );
        const visibleReminders = filterCalendarReminderDuplicates(
          remindersData.items ?? [],
          visibleEvents
        );

        const events: EventInput[] = [
          ...visibleEvents.map((occurrence) =>
            calendarEventToFcEvent(
              occurrence.event,
              occurrence.displayStartAtMs,
              occurrence.displayEndAtMs
            )
          ),
          ...visibleReminders.map(reminderToFcEvent)
        ];
        if (fetchRequestIdRef.current !== requestId) {
          return;
        }
        setFullCalendarEvents(events);
      } catch (err) {
        console.error("[CalendarView] fetch error:", err);
      }
    },
    [accountId]
  );

  const handleDatesSet = useCallback(
    (arg: DatesSetArg) => {
      if (!compact) {
        try {
          localStorage.setItem(CALENDAR_VIEW_KEY, arg.view.type);
          // currentStart is the interval start (1st of month / week start),
          // not arg.start, which can bleed into the previous month's days.
          sessionStorage.setItem(CALENDAR_DATE_KEY, arg.view.currentStart.toISOString());
        } catch {}
      }
      const startMs = arg.start.getTime();
      const endMs = arg.end.getTime();
      const prev = fetchRangeRef.current;
      if (prev && prev.startMs === startMs && prev.endMs === endMs) return;
      fetchRangeRef.current = { startMs, endMs };
      void fetchEvents(startMs, endMs);
    },
    [compact, fetchEvents]
  );

  const handleEventClick = useCallback(
    (arg: EventClickArg) => {
      const props = arg.event.extendedProps as {
        kind: "event" | "reminder";
        data: CalendarEvent | CalendarReminder;
        displayStartAtMs?: number;
      };
      onEventClick?.(props.data, props.kind, props.displayStartAtMs);
    },
    [onEventClick]
  );

  const handleDateClick = useCallback(
    (arg: { date: Date; allDay: boolean }) => {
      onDateClick?.(arg.date, arg.allDay);
    },
    [onDateClick]
  );

  const handleEventDidMount = useCallback(
    (arg: EventMountArg) => {
      arg.el.title = buildEventHoverTitle(arg, dateFormat);
    },
    [dateFormat]
  );

  // Refetch when accountId changes
  useEffect(() => {
    if (previousAccountIdRef.current === null) {
      previousAccountIdRef.current = accountId;
      return;
    }
    if (previousAccountIdRef.current === accountId) return;
    previousAccountIdRef.current = accountId;
    fetchRangeRef.current = null;
    fetchRequestIdRef.current += 1;
  }, [accountId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleCalendarDataUpdated = () => {
      const range =
        fetchRangeRef.current ??
        (() => {
          const view = calendarRef.current?.getApi().view;
          if (!view) return null;
          return {
            startMs: view.activeStart.getTime(),
            endMs: view.activeEnd.getTime()
          };
        })();
      if (!range) return;
      fetchRangeRef.current = range;
      void fetchEvents(range.startMs, range.endMs);
    };
    window.addEventListener(CALENDAR_EVENTS_UPDATED_EVENT, handleCalendarDataUpdated);
    window.addEventListener(CALENDAR_REMINDERS_UPDATED_EVENT, handleCalendarDataUpdated);
    return () => {
      window.removeEventListener(CALENDAR_EVENTS_UPDATED_EVENT, handleCalendarDataUpdated);
      window.removeEventListener(CALENDAR_REMINDERS_UPDATED_EVENT, handleCalendarDataUpdated);
    };
  }, [calendarRef, fetchEvents]);

  if (compact) {
    return (
      <div className="fc-compact">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, rrulePlugin]}
          initialView="dayGridMonth"
          headerToolbar={false}
          firstDay={firstDay}
          events={fullCalendarEvents}
          eventDidMount={handleEventDidMount}
          datesSet={handleDatesSet}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          height="auto"
          aspectRatio={1.4}
          fixedWeekCount={false}
        />
      </div>
    );
  }

  return (
    <FullCalendar
      ref={calendarRef}
      plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, rrulePlugin]}
      initialView={initialView}
      initialDate={initialDate}
      views={{
        // Keep short events readable without making back-to-back entries tall
        // enough to be treated like overlapping conflicts.
        timeGrid: {
          eventMinHeight: 10
        }
      }}
      customButtons={
        onCreateEvent
          ? {
              addEvent: {
                // FullCalendar buttons are text-only; the leading "＋" reads as
                // a create affordance and `hint` supplies the title/aria-label.
                text: "＋ Event",
                hint: "New event",
                click: () => onCreateEvent()
              }
            }
          : undefined
      }
      headerToolbar={{
        left: onCreateEvent ? "addEvent today" : "today",
        center: "prev title next",
        right: "dayGridMonth,timeGridWeek,timeGridDay"
      }}
      firstDay={firstDay}
      events={fullCalendarEvents}
      eventDidMount={handleEventDidMount}
      nowIndicator
      datesSet={handleDatesSet}
      eventClick={handleEventClick}
      dateClick={handleDateClick}
      height="100%"
      fixedWeekCount={false}
    />
  );
}
