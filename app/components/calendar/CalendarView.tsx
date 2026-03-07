"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import rrulePlugin from "@fullcalendar/rrule";
import type { EventClickArg, DateSelectArg, DatesSetArg, EventInput } from "@fullcalendar/core";
import type { CalendarEvent } from "@/lib/data";
import type { CalendarReminder } from "@/lib/data";
import {
  expandCalendarEventForRange,
  filterCalendarReminderDuplicates
} from "@/lib/calendarOccurrences";
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
  onDateClick?: (date: Date) => void;
  onCreateEvent?: (start: Date, end: Date, allDay: boolean) => void;
  calendarRef?: React.RefObject<FullCalendar | null>;
};

function calendarEventToFcEvent(
  ev: CalendarEvent,
  displayStartAtMs = ev.startAtMs,
  displayEndAtMs = ev.endAtMs
): EventInput {
  return {
    id: ev.recurrenceRule?.trim() ? `${ev.id}-${displayStartAtMs}` : ev.id,
    title: ev.summary,
    start: new Date(displayStartAtMs),
    end: displayEndAtMs ? new Date(displayEndAtMs) : undefined,
    allDay: ev.allDay,
    classNames: [
      `fc-event-${ev.sourceType}`,
      ...(ev.myPartstat ? [`fc-event-partstat-${ev.myPartstat.toLowerCase().replace(/-/g, "")}`] : [])
    ],
    extendedProps: { kind: "event", data: ev, displayStartAtMs }
  };
}

function reminderToFcEvent(r: CalendarReminder): EventInput {
  const startMs = r.nextEventStartAtMs ?? r.eventStartAtMs;
  return {
    id: `reminder-${r.id}`,
    title: r.eventTitle,
    start: new Date(startMs),
    end: r.eventEndAtMs ? new Date(startMs + (r.eventEndAtMs - r.eventStartAtMs)) : undefined,
    allDay: false,
    classNames: ["fc-event-reminder"],
    extendedProps: { kind: "reminder", data: r }
  };
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
  const internalRef = useRef<FullCalendar>(null);
  const calendarRef = (externalRef ?? internalRef) as React.RefObject<FullCalendar>;
  const [fcEvents, setFcEvents] = useState<EventInput[]>([]);
  const fetchRangeRef = useRef<{ startMs: number; endMs: number } | null>(null);

  const fetchEvents = useCallback(
    async (startMs: number, endMs: number) => {
      if (!accountId) return;
      try {
        const params = new URLSearchParams({
          accountId,
          startMs: String(startMs),
          endMs: String(endMs)
        });
        const [eventsRes, remindersRes] = await Promise.all([
          fetch(`/api/calendar/events?${params.toString()}`),
          fetch(`/api/reminders?accountId=${encodeURIComponent(accountId)}`)
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
        setFcEvents(events);
      } catch (err) {
        console.error("[CalendarView] fetch error:", err);
      }
    },
    [accountId]
  );

  const handleDatesSet = useCallback(
    (arg: DatesSetArg) => {
      const startMs = arg.start.getTime();
      const endMs = arg.end.getTime();
      const prev = fetchRangeRef.current;
      if (prev && prev.startMs === startMs && prev.endMs === endMs) return;
      fetchRangeRef.current = { startMs, endMs };
      void fetchEvents(startMs, endMs);
    },
    [fetchEvents]
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
    (arg: { date: Date }) => {
      onDateClick?.(arg.date);
    },
    [onDateClick]
  );

  const handleSelect = useCallback(
    (arg: DateSelectArg) => {
      onCreateEvent?.(arg.start, arg.end, arg.allDay);
    },
    [onCreateEvent]
  );

  // Refetch when accountId changes
  useEffect(() => {
    fetchRangeRef.current = null;
  }, [accountId]);

  if (compact) {
    return (
      <div className="fc-compact">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, rrulePlugin]}
          initialView="dayGridMonth"
          headerToolbar={false}
          firstDay={firstDay}
          events={fcEvents}
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
      initialView="dayGridMonth"
      headerToolbar={{
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,timeGridWeek,timeGridDay"
      }}
      firstDay={firstDay}
      events={fcEvents}
      datesSet={handleDatesSet}
      eventClick={handleEventClick}
      dateClick={handleDateClick}
      selectable={Boolean(onCreateEvent)}
      select={handleSelect}
      height="100%"
      fixedWeekCount={false}
    />
  );
}
