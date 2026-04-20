import { describe, expect, it } from "bun:test";
import type { CalendarReminder } from "@/lib/data";
import {
  buildReminderNotificationBody,
  buildReminderServiceWorkerPayload,
  filterUpcomingCalendarReminders,
  selectDueUndeliveredReminders
} from "./reminderNotificationHelpers";

function makeReminder(overrides?: Partial<CalendarReminder>): CalendarReminder {
  const eventStart = overrides?.eventStartAtMs ?? 10_000_000;
  const defaultEnd = eventStart + 30 * 60 * 1000;
  return {
    id: "r1",
    accountId: "acc",
    userId: "u1",
    eventTitle: "Standup",
    eventStartAtMs: eventStart,
    eventEndAtMs: defaultEnd,
    nextEventStartAtMs: eventStart,
    leadMinutes: 5,
    leadLabel: "5 minutes before",
    triggerAtMs: eventStart - 5 * 60 * 1000,
    createdAtMs: 0,
    updatedAtMs: 0,
    ...overrides
  };
}

describe("filterUpcomingCalendarReminders", () => {
  it("keeps reminders whose event has not yet ended", () => {
    const future = makeReminder({ id: "future", eventStartAtMs: 20_000, eventEndAtMs: 21_000 });
    const past = makeReminder({ id: "past", eventStartAtMs: 1_000, eventEndAtMs: 2_000 });
    expect(filterUpcomingCalendarReminders([future, past], 10_000).map((r) => r.id)).toEqual([
      "future"
    ]);
  });

  it("returns an empty array when every reminder is in the past", () => {
    const past = makeReminder({ eventStartAtMs: 1, eventEndAtMs: 2 });
    expect(filterUpcomingCalendarReminders([past], 10_000)).toEqual([]);
  });
});

describe("selectDueUndeliveredReminders", () => {
  it("skips reminders that have not yet triggered", () => {
    const reminder = makeReminder({ triggerAtMs: 1000, eventStartAtMs: 2000, eventEndAtMs: 3000 });
    expect(selectDueUndeliveredReminders([reminder], 500, () => false)).toEqual([]);
  });

  it("skips reminders whose event already ended", () => {
    const reminder = makeReminder({ triggerAtMs: 1000, eventStartAtMs: 2000, eventEndAtMs: 3000 });
    expect(selectDueUndeliveredReminders([reminder], 4000, () => false)).toEqual([]);
  });

  it("skips reminders that have already been delivered", () => {
    const reminder = makeReminder({ triggerAtMs: 1000, eventStartAtMs: 2000, eventEndAtMs: 3000 });
    expect(selectDueUndeliveredReminders([reminder], 1500, () => true)).toEqual([]);
  });

  it("keeps reminders that are due, pending, and not yet delivered", () => {
    const reminder = makeReminder({ triggerAtMs: 1000, eventStartAtMs: 2000, eventEndAtMs: 3000 });
    expect(selectDueUndeliveredReminders([reminder], 1500, () => false)).toEqual([reminder]);
  });
});

describe("buildReminderNotificationBody", () => {
  it("joins lead, start label, and location with middle dots", () => {
    const reminder = makeReminder({ leadLabel: "5m", eventLocation: "Room 3" });
    expect(buildReminderNotificationBody(reminder, "Mon 10:00")).toBe(
      "5m reminder \u00b7 Starts Mon 10:00 \u00b7 Room 3"
    );
  });

  it("omits the location segment when absent", () => {
    const reminder = makeReminder({ leadLabel: "5m", eventLocation: undefined });
    expect(buildReminderNotificationBody(reminder, "Mon 10:00")).toBe(
      "5m reminder \u00b7 Starts Mon 10:00"
    );
  });
});

describe("buildReminderServiceWorkerPayload", () => {
  it("includes only accounts with a non-empty delivered map", () => {
    const reminder = makeReminder({ id: "r42" });
    const payload = buildReminderServiceWorkerPayload(
      ["a", "b", "c"],
      "a",
      [reminder],
      (accountId) => (accountId === "b" ? { r99: 1 } : {})
    );
    expect(payload.type).toBe("noctua:reminder-state");
    expect(payload.accountIds).toEqual(["a", "b", "c"]);
    expect(payload.deliveredByAccount).toEqual({ b: { r99: 1 } });
    expect(payload.activeAccountId).toBe("a");
    expect(payload.activeReminderIds).toEqual(["r42"]);
  });

  it("emits null activeAccountId when none is active", () => {
    const payload = buildReminderServiceWorkerPayload([], "", [], () => ({}));
    expect(payload.activeAccountId).toBeNull();
    expect(payload.activeReminderIds).toEqual([]);
  });
});
