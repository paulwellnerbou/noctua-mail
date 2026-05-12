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
        { id: "r1", messageId: "m1", eventUid: "event-1" },
        { id: "r2", eventUid: "EVENT-2" }
      ],
      events: [
        { id: "e1", eventUid: "event-1", isFuture: true },
        { id: "e2", eventUid: "event-2", isFuture: false }
      ]
    });

    expect(result).toEqual({
      linkedMessageCount: 2,
      linkedReminderCount: 2,
      linkedEventCount: 2,
      linkedEventFutureCount: 1,
      linkedEventPastCount: 1
    });
  });

  it("deduplicates repeated reminder and event matches", () => {
    const messages = [
      makeMessage({ id: "m1", calendarEventUids: ["event-1"] }),
      makeMessage({ id: "m2", calendarEventUids: ["event-1"] })
    ];

    const result = summarizeDeleteCalendarAssociations(messages, {
      reminders: [
        { id: "r1", eventUid: "event-1" },
        { id: "r1", messageId: "m1", eventUid: "event-1" }
      ],
      events: [
        { id: "e1", eventUid: "event-1", isFuture: true },
        { id: "e1", eventUid: "EVENT-1", isFuture: true }
      ]
    });

    expect(result).toEqual({
      linkedMessageCount: 2,
      linkedReminderCount: 1,
      linkedEventCount: 1,
      linkedEventFutureCount: 1,
      linkedEventPastCount: 0
    });
  });

  it("ignores unrelated reminders and calendar events", () => {
    const result = summarizeDeleteCalendarAssociations([makeMessage({ id: "m1" })], {
      reminders: [{ id: "r1", messageId: "m2", eventUid: "event-1" }],
      events: [{ id: "e1", eventUid: "event-1", isFuture: true }]
    });

    expect(result).toEqual({
      linkedMessageCount: 0,
      linkedReminderCount: 0,
      linkedEventCount: 0,
      linkedEventFutureCount: 0,
      linkedEventPastCount: 0
    });
  });

  it("counts past events when isFuture is missing or false", () => {
    const messages = [makeMessage({ id: "m1", calendarEventUids: ["event-1"] })];

    const result = summarizeDeleteCalendarAssociations(messages, {
      reminders: [],
      events: [{ id: "e1", eventUid: "event-1" }]
    });

    expect(result).toEqual({
      linkedMessageCount: 1,
      linkedReminderCount: 0,
      linkedEventCount: 1,
      linkedEventFutureCount: 0,
      linkedEventPastCount: 1
    });
  });
});
