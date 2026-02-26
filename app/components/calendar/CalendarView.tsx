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
import "./fullcalendar-theme.css";

export type CalendarViewHandle = {
  goToDate: (date: Date) => void;
  goToToday: () => void;
};

type Props = {
  accountId: string;
  compact?: boolean;
  onEventClick?: (event: CalendarEvent | CalendarReminder, kind: "event" | "reminder") => void;
  onDateClick?: (date: Date) => void;
  onCreateEvent?: (start: Date, end: Date, allDay: boolean) => void;
  calendarRef?: React.RefObject<FullCalendar | null>;
};

function calendarEventToFcEvent(ev: CalendarEvent): EventInput {
  const base: EventInput = {
    id: ev.id,
    title: ev.summary,
    start: new Date(ev.startAtMs),
    end: ev.endAtMs ? new Date(ev.endAtMs) : undefined,
    allDay: ev.allDay,
    classNames: [`fc-event-${ev.sourceType}`],
    extendedProps: { kind: "event", data: ev }
  };
  if (ev.recurrenceRule) {
    return {
      ...base,
      rrule: {
        dtstart: new Date(ev.startAtMs).toISOString(),
        freq: "weekly", // will be overridden by rrule string below
        ...parseRruleForFc(ev.recurrenceRule, ev.startAtMs)
      },
      duration: ev.endAtMs ? { milliseconds: ev.endAtMs - ev.startAtMs } : undefined
    };
  }
  return base;
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

function parseRruleForFc(rule: string, startMs: number): Record<string, unknown> {
  // Pass the raw rrule string through to the rrule plugin
  return {
    dtstart: new Date(startMs).toISOString(),
    rrule: rule.startsWith("RRULE:") ? rule : `RRULE:${rule}`
  };
}

export default function CalendarView({
  accountId,
  compact = false,
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

        const events: EventInput[] = [
          ...(eventsData.items ?? []).map(calendarEventToFcEvent),
          ...(remindersData.items ?? []).map(reminderToFcEvent)
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
      const props = arg.event.extendedProps as { kind: "event" | "reminder"; data: CalendarEvent | CalendarReminder };
      onEventClick?.(props.data, props.kind);
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
