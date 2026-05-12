import { describe, expect, it } from "bun:test";

import type { Message } from "@/lib/data";
import {
  collectDeleteConfirmEventUids,
  summarizeDeleteCalendarAssociations
} from "./deleteConfirm";

function makeMessage(overrides?: Partial<Message>): Message {
  return {
    id: "m1",
    threadId: "thread-1",
    subject: "Subject",
    from: "alice@example.com",
    to: "bob@example.com",
    preview: "Preview",
    date: new Date(0).toISOString(),
    dateValue: 0,
    folderId: "acc:INBOX",
    accountId: "acc",
    body: "",
    ...overrides
  };
}

describe("collectDeleteConfirmEventUids", () => {
  it("returns normalized unique event UIDs", () => {
    const result = collectDeleteConfirmEventUids([
      makeMessage({ calendarEventUids: [" EVENT-1 ", "event-2"] }),
      makeMessage({ id: "m2", calendarEventUids: ["event-1", ""] })
    ]);

    expect(result).toEqual(["event-1", "event-2"]);
  });
});

describe("summarizeDeleteCalendarAssociations", () => {
  it("counts linked reminders and events across message IDs and event UIDs", () => {
    const messages = [
      makeMessage({ id: "m1", calendarEventUids: ["event-1"] }),
      makeMessage({ id: "m2", calendarEventUids: ["event-2"] })
    ];

    const result = summarizeDeleteCalendarAssociations(messages, {
      reminders: [
        { id: "r1", messageId: "m1", eventUid: "event-1", isFuture: true },
        { id: "r2", eventUid: "EVENT-2", isFuture: false }
      ],
      events: [
        {
          id: "e1",
          eventUid: "event-1",
          summary: "Standup",
          occurrenceStartAtMs: 1_700_000_000_000,
          occurrenceEndAtMs: 1_700_000_900_000,
          isFuture: true
        },
        {
          id: "e2",
          eventUid: "event-2",
          summary: "Retro",
          occurrenceStartAtMs: 1_600_000_000_000,
          isFuture: false
        }
      ]
    });

    expect(result.linkedMessageCount).toBe(2);
    expect(result.linkedReminderCount).toBe(2);
    expect(result.linkedReminderFutureCount).toBe(1);
    expect(result.linkedReminderPastCount).toBe(1);
    expect(result.linkedEventCount).toBe(2);
    expect(result.linkedEventFutureCount).toBe(1);
    expect(result.linkedEventPastCount).toBe(1);
    expect(result.linkedEvents.map((event) => event.id)).toEqual(["e1", "e2"]);
    expect(result.linkedEvents[0]).toMatchObject({
      id: "e1",
      summary: "Standup",
      isFuture: true,
      occurrenceStartAtMs: 1_700_000_000_000,
      occurrenceEndAtMs: 1_700_000_900_000
    });
  });

  it("deduplicates repeated reminder and event matches", () => {
    const messages = [
      makeMessage({ id: "m1", calendarEventUids: ["event-1"] }),
      makeMessage({ id: "m2", calendarEventUids: ["event-1"] })
    ];

    const result = summarizeDeleteCalendarAssociations(messages, {
      reminders: [
        { id: "r1", eventUid: "event-1", isFuture: true },
        { id: "r1", messageId: "m1", eventUid: "event-1", isFuture: true }
      ],
      events: [
        { id: "e1", eventUid: "event-1", isFuture: true, summary: "Meeting" },
        { id: "e1", eventUid: "EVENT-1", isFuture: true, summary: "Meeting" }
      ]
    });

    expect(result.linkedMessageCount).toBe(2);
    expect(result.linkedReminderCount).toBe(1);
    expect(result.linkedReminderFutureCount).toBe(1);
    expect(result.linkedReminderPastCount).toBe(0);
    expect(result.linkedEventCount).toBe(1);
    expect(result.linkedEventFutureCount).toBe(1);
    expect(result.linkedEventPastCount).toBe(0);
    expect(result.linkedEvents).toHaveLength(1);
    expect(result.linkedEvents[0]?.id).toBe("e1");
  });

  it("ignores unrelated reminders and calendar events", () => {
    const result = summarizeDeleteCalendarAssociations([makeMessage({ id: "m1" })], {
      reminders: [{ id: "r1", messageId: "m2", eventUid: "event-1", isFuture: true }],
      events: [{ id: "e1", eventUid: "event-1", isFuture: true }]
    });

    expect(result.linkedMessageCount).toBe(0);
    expect(result.linkedReminderCount).toBe(0);
    expect(result.linkedEventCount).toBe(0);
    expect(result.linkedEvents).toEqual([]);
  });

  it("counts past items when isFuture is missing or false", () => {
    const messages = [makeMessage({ id: "m1", calendarEventUids: ["event-1"] })];

    const result = summarizeDeleteCalendarAssociations(messages, {
      reminders: [{ id: "r1", messageId: "m1" }],
      events: [{ id: "e1", eventUid: "event-1" }]
    });

    expect(result.linkedMessageCount).toBe(1);
    expect(result.linkedReminderCount).toBe(1);
    expect(result.linkedReminderFutureCount).toBe(0);
    expect(result.linkedReminderPastCount).toBe(1);
    expect(result.linkedEventCount).toBe(1);
    expect(result.linkedEventFutureCount).toBe(0);
    expect(result.linkedEventPastCount).toBe(1);
    expect(result.linkedEvents[0]).toMatchObject({ id: "e1", isFuture: false });
  });
});
