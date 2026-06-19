import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { CalendarEvent } from "@/lib/data";

const getCalendarEventById = mock(() => Promise.resolve<CalendarEvent | null>(null));
const softDeleteCalendarEvent = mock(() => Promise.resolve());
const deleteCalendarEvent = mock(() => Promise.resolve());
const cancelCalendarRemindersByEventUid = mock(() => Promise.resolve(0));
const clearMessageCalendarInviteStatesProcessedByEventUid = mock(() => Promise.resolve(0));
const addCalendarEventSuppression = mock(() => Promise.resolve(true));

const actualDb = await import("./db");
mock.module("@/lib/db", () => ({
  ...actualDb,
  getCalendarEventById,
  softDeleteCalendarEvent,
  deleteCalendarEvent,
  cancelCalendarRemindersByEventUid,
  clearMessageCalendarInviteStatesProcessedByEventUid,
  addCalendarEventSuppression
}));

const { deleteCalendarEventAndRelatedData } = await import("./calendarEventDeletion");

mock.restore();

function buildEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const now = Date.now();
  return {
    id: "cal-1",
    accountId: "acc-1",
    eventUid: "event-1@example.test",
    summary: "Test Event",
    startAtMs: Date.UTC(2026, 2, 12, 8, 0, 0),
    endAtMs: Date.UTC(2026, 2, 12, 8, 30, 0),
    allDay: false,
    sourceType: "local",
    createdAtMs: now,
    updatedAtMs: now,
    ...overrides
  };
}

describe("deleteCalendarEventAndRelatedData", () => {
  beforeEach(() => {
    getCalendarEventById.mockClear();
    softDeleteCalendarEvent.mockClear();
    deleteCalendarEvent.mockClear();
    cancelCalendarRemindersByEventUid.mockClear();
    clearMessageCalendarInviteStatesProcessedByEventUid.mockClear();
    addCalendarEventSuppression.mockClear();
  });

  test("soft deletes imported email events and re-enables invite processing", async () => {
    getCalendarEventById.mockResolvedValue(
      buildEvent({
        sourceType: "email",
        messageId: "msg-1",
        rawIcs: "BEGIN:VCALENDAR\r\nEND:VCALENDAR"
      })
    );

    const result = await deleteCalendarEventAndRelatedData({
      accountId: "acc-1",
      eventId: "cal-1",
      softDelete: true
    });

    expect(result.deleted).toBe(true);
    expect(result.event?.id).toBe("cal-1");
    expect(softDeleteCalendarEvent).toHaveBeenCalledWith("acc-1", "cal-1");
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
    expect(cancelCalendarRemindersByEventUid).toHaveBeenCalledWith("acc-1", "event-1@example.test");
    expect(clearMessageCalendarInviteStatesProcessedByEventUid).toHaveBeenCalledWith(
      "acc-1",
      "event-1@example.test"
    );
    expect(addCalendarEventSuppression).toHaveBeenCalledWith("acc-1", "event-1@example.test");
  });

  test("hard deletes local events without touching invite state", async () => {
    getCalendarEventById.mockResolvedValue(buildEvent());

    const result = await deleteCalendarEventAndRelatedData({
      accountId: "acc-1",
      eventId: "cal-1"
    });

    expect(result.deleted).toBe(true);
    expect(deleteCalendarEvent).toHaveBeenCalledWith("acc-1", "cal-1");
    expect(softDeleteCalendarEvent).not.toHaveBeenCalled();
    expect(cancelCalendarRemindersByEventUid).toHaveBeenCalledWith("acc-1", "event-1@example.test");
    expect(clearMessageCalendarInviteStatesProcessedByEventUid).not.toHaveBeenCalled();
    expect(addCalendarEventSuppression).not.toHaveBeenCalled();
  });

  test("hard deletes sent invite events without touching inbound invite state", async () => {
    getCalendarEventById.mockResolvedValue(
      buildEvent({
        sourceType: "sent-invite",
        rawIcs: "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR"
      })
    );

    const result = await deleteCalendarEventAndRelatedData({
      accountId: "acc-1",
      eventId: "cal-1"
    });

    expect(result.deleted).toBe(true);
    expect(deleteCalendarEvent).toHaveBeenCalledWith("acc-1", "cal-1");
    expect(cancelCalendarRemindersByEventUid).toHaveBeenCalledWith("acc-1", "event-1@example.test");
    expect(clearMessageCalendarInviteStatesProcessedByEventUid).not.toHaveBeenCalled();
    expect(addCalendarEventSuppression).not.toHaveBeenCalled();
  });

  test("hard deletes imported email events and suppresses re-creation", async () => {
    getCalendarEventById.mockResolvedValue(
      buildEvent({
        sourceType: "email",
        messageId: "msg-1",
        rawIcs: "BEGIN:VCALENDAR\r\nEND:VCALENDAR"
      })
    );

    const result = await deleteCalendarEventAndRelatedData({
      accountId: "acc-1",
      eventId: "cal-1"
    });

    expect(result.deleted).toBe(true);
    expect(deleteCalendarEvent).toHaveBeenCalledWith("acc-1", "cal-1");
    expect(addCalendarEventSuppression).toHaveBeenCalledWith("acc-1", "event-1@example.test");
  });

  test("records the suppression before re-enabling invite processing", async () => {
    getCalendarEventById.mockResolvedValue(
      buildEvent({ sourceType: "email", messageId: "msg-1" })
    );
    const order: string[] = [];
    addCalendarEventSuppression.mockImplementationOnce(async () => {
      order.push("suppress");
      return true;
    });
    clearMessageCalendarInviteStatesProcessedByEventUid.mockImplementationOnce(async () => {
      order.push("clear");
      return 0;
    });

    await deleteCalendarEventAndRelatedData({ accountId: "acc-1", eventId: "cal-1" });

    // Order matters: a suppression-write failure must not be able to leave the
    // series re-armed for re-import with no suppression record.
    expect(order).toEqual(["suppress", "clear"]);
  });

  test("returns without side effects when the event does not exist", async () => {
    getCalendarEventById.mockResolvedValue(null);

    const result = await deleteCalendarEventAndRelatedData({
      accountId: "acc-1",
      eventId: "missing"
    });

    expect(result).toEqual({ event: null, deleted: false });
    expect(deleteCalendarEvent).not.toHaveBeenCalled();
    expect(softDeleteCalendarEvent).not.toHaveBeenCalled();
    expect(cancelCalendarRemindersByEventUid).not.toHaveBeenCalled();
    expect(clearMessageCalendarInviteStatesProcessedByEventUid).not.toHaveBeenCalled();
    expect(addCalendarEventSuppression).not.toHaveBeenCalled();
  });
});
