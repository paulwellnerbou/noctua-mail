import { describe, expect, it } from "bun:test";
import type { CalendarEvent, CalendarReminder } from "@/lib/data";
import {
  buildUpcomingEntries,
  DEFAULT_UPCOMING_CAP,
  DEFAULT_UPCOMING_WINDOW_MS
} from "./upcomingEntries";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function makeEvent(overrides: Partial<CalendarEvent> & { id: string; startAtMs: number }): CalendarEvent {
  return {
    id: overrides.id,
    accountId: "acct-1",
    eventUid: overrides.eventUid ?? `uid-${overrides.id}`,
    summary: overrides.summary ?? `Event ${overrides.id}`,
    startAtMs: overrides.startAtMs,
    endAtMs: overrides.endAtMs,
    allDay: overrides.allDay ?? false,
    startTimezone: overrides.startTimezone,
    location: overrides.location,
    recurrenceRule: overrides.recurrenceRule,
    sourceType: overrides.sourceType ?? "local",
    messageId: overrides.messageId,
    createdAtMs: overrides.createdAtMs ?? 0,
    updatedAtMs: overrides.updatedAtMs ?? 0
  };
}

function makeReminder(
  overrides: Partial<CalendarReminder> & {
    id: string;
    eventStartAtMs: number;
    nextEventStartAtMs?: number;
  }
): CalendarReminder {
  const nextStart = overrides.nextEventStartAtMs ?? overrides.eventStartAtMs;
  return {
    id: overrides.id,
    accountId: "acct-1",
    userId: "user-1",
    eventUid: overrides.eventUid,
    messageId: overrides.messageId,
    eventTitle: overrides.eventTitle ?? `Reminder ${overrides.id}`,
    eventLocation: overrides.eventLocation,
    startTimezone: overrides.startTimezone,
    eventStartAtMs: overrides.eventStartAtMs,
    eventEndAtMs: overrides.eventEndAtMs,
    nextEventStartAtMs: nextStart,
    leadMinutes: overrides.leadMinutes ?? 15,
    leadLabel: overrides.leadLabel ?? "15 minutes",
    triggerAtMs: nextStart - (overrides.leadMinutes ?? 15) * 60_000,
    createdAtMs: overrides.createdAtMs ?? 0,
    updatedAtMs: overrides.updatedAtMs ?? 0
  };
}

describe("buildUpcomingEntries", () => {
  const nowMs = 1_700_000_000_000;

  it("returns an empty list when both inputs are empty", () => {
    const { entries, mergedCount } = buildUpcomingEntries([], [], { nowMs });
    expect(entries).toEqual([]);
    expect(mergedCount).toBe(0);
  });

  it("filters events outside the 4-week window", () => {
    const events = [
      makeEvent({ id: "e1", startAtMs: nowMs + 1 * DAY }),
      // 5 weeks out — outside the window.
      makeEvent({ id: "e2", startAtMs: nowMs + 35 * DAY }),
      // In the past — excluded.
      makeEvent({ id: "e3", startAtMs: nowMs - 1 * DAY })
    ];
    const { entries, mergedCount } = buildUpcomingEntries(events, [], { nowMs });
    expect(mergedCount).toBe(1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.event?.id).toBe("e1");
  });

  it("merges a reminder into its matching event (shared eventUid)", () => {
    const startAtMs = nowMs + 2 * DAY;
    const events = [
      makeEvent({ id: "e1", eventUid: "UID-ABC", startAtMs, summary: "Standup" })
    ];
    const reminders = [
      makeReminder({
        id: "r1",
        eventUid: "uid-abc", // different case — normalized match
        eventStartAtMs: startAtMs,
        leadLabel: "10 minutes",
        leadMinutes: 10
      })
    ];
    const { entries, mergedCount } = buildUpcomingEntries(events, reminders, { nowMs });
    expect(mergedCount).toBe(1);
    expect(entries).toHaveLength(1);
    const merged = entries[0];
    expect(merged.title).toBe("Standup");
    expect(merged.event?.id).toBe("e1");
    expect(merged.reminder?.id).toBe("r1");
    expect(merged.reminder?.leadLabel).toBe("10 minutes");
  });

  it("keeps a reminder as its own entry when its event is outside the window", () => {
    // Reminder fires soon but the underlying event is 10 weeks out,
    // so it is NOT in the events list for the window.
    const reminderStart = nowMs + 1 * HOUR;
    const reminders = [
      makeReminder({
        id: "r1",
        eventUid: "UID-X",
        eventStartAtMs: reminderStart,
        eventTitle: "Far-future meeting"
      })
    ];
    const { entries, mergedCount } = buildUpcomingEntries([], reminders, { nowMs });
    expect(mergedCount).toBe(1);
    expect(entries[0]?.reminder?.id).toBe("r1");
    expect(entries[0]?.event).toBeUndefined();
  });

  it("sorts combined entries chronologically ascending", () => {
    const events = [
      makeEvent({ id: "e-late", startAtMs: nowMs + 10 * DAY }),
      makeEvent({ id: "e-early", startAtMs: nowMs + 1 * DAY })
    ];
    const reminders = [
      makeReminder({ id: "r-mid", eventStartAtMs: nowMs + 5 * DAY })
    ];
    const { entries } = buildUpcomingEntries(events, reminders, { nowMs });
    const ids = entries.map((e) => e.event?.id ?? e.reminder?.id);
    expect(ids).toEqual(["e-early", "r-mid", "e-late"]);
  });

  it("caps the output at 10 rows while reporting the true merged count", () => {
    const events = Array.from({ length: 15 }, (_, i) =>
      makeEvent({ id: `e${i}`, startAtMs: nowMs + (i + 1) * HOUR })
    );
    const { entries, mergedCount } = buildUpcomingEntries(events, [], { nowMs });
    expect(entries).toHaveLength(DEFAULT_UPCOMING_CAP);
    expect(mergedCount).toBe(15);
  });

  it("prefers reminder.messageId when the merged event has none", () => {
    const startAtMs = nowMs + 2 * DAY;
    const events = [
      makeEvent({ id: "e1", eventUid: "UID-ABC", startAtMs })
    ];
    const reminders = [
      makeReminder({
        id: "r1",
        eventUid: "UID-ABC",
        eventStartAtMs: startAtMs,
        messageId: "msg-42"
      })
    ];
    const { entries } = buildUpcomingEntries(events, reminders, { nowMs });
    expect(entries[0]?.messageId).toBe("msg-42");
  });

  it("uses event.messageId when both are present (event wins)", () => {
    const startAtMs = nowMs + 2 * DAY;
    const events = [
      makeEvent({
        id: "e1",
        eventUid: "UID-ABC",
        startAtMs,
        messageId: "msg-event"
      })
    ];
    const reminders = [
      makeReminder({
        id: "r1",
        eventUid: "UID-ABC",
        eventStartAtMs: startAtMs,
        messageId: "msg-reminder"
      })
    ];
    const { entries } = buildUpcomingEntries(events, reminders, { nowMs });
    expect(entries[0]?.messageId).toBe("msg-event");
  });

  it("honors a custom cap and window", () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      makeEvent({ id: `e${i}`, startAtMs: nowMs + (i + 1) * HOUR })
    );
    const { entries, mergedCount } = buildUpcomingEntries(events, [], {
      nowMs,
      capAt: 3,
      windowMs: DEFAULT_UPCOMING_WINDOW_MS
    });
    expect(entries).toHaveLength(3);
    expect(mergedCount).toBe(6);
  });

  it("event-only entries have no attached reminder (and therefore no delete target)", () => {
    const events = [makeEvent({ id: "e1", startAtMs: nowMs + 1 * DAY })];
    const { entries } = buildUpcomingEntries(events, [], { nowMs });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.reminder).toBeUndefined();
    // Mirror the UI rule: the delete button is only rendered when a
    // reminder is attached.
    const shouldRenderDelete = entries[0]?.reminder !== undefined;
    expect(shouldRenderDelete).toBe(false);
  });

  it("reminder-only entries carry the reminder (so the delete button renders)", () => {
    const reminders = [makeReminder({ id: "r1", eventStartAtMs: nowMs + 1 * DAY })];
    const { entries } = buildUpcomingEntries([], reminders, { nowMs });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.reminder?.id).toBe("r1");
    const shouldRenderDelete = entries[0]?.reminder !== undefined;
    expect(shouldRenderDelete).toBe(true);
  });
});
