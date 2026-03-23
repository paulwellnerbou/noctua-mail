import { describe, expect, test } from "bun:test";
import type { Message } from "@/lib/data";
import {
  mergeMessageInviteStatePatches,
  type InviteProcessingStatePatch
} from "./calendarInviteState";

function buildMessage(overrides?: Partial<Message>): Message {
  return {
    id: "message-1",
    accountId: "account-1",
    folderId: "folder-1",
    subject: "Subject",
    from: "sender@example.com",
    to: "recipient@example.com",
    preview: "Preview",
    date: new Date(Date.UTC(2026, 2, 23, 10, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 2, 23, 10, 0, 0),
    body: "Body",
    ...overrides
  };
}

describe("mergeMessageInviteStatePatches", () => {
  test("updates an existing invite state in place", () => {
    const message = buildMessage({
      calendarEventUids: ["event-1"],
      calendarInviteStates: [
        {
          eventUid: "event-1",
          actionType: "update"
        }
      ]
    });

    const result = mergeMessageInviteStatePatches(message, [
      {
        eventUid: "event-1",
        processedAtMs: 1234,
        processedAutomatically: false
      }
    ]);

    expect(result.calendarInviteStates).toEqual([
      {
        eventUid: "event-1",
        actionType: "update",
        processedAtMs: 1234,
        processedAutomatically: false
      }
    ]);
    expect(result.calendarEventUids).toEqual(["event-1"]);
  });

  test("appends a new invite state when the action type is provided", () => {
    const message = buildMessage();
    const patches: InviteProcessingStatePatch[] = [
      {
        eventUid: "event-2",
        actionType: "invitation",
        processedAtMs: 5678,
        processedAutomatically: true
      }
    ];

    const result = mergeMessageInviteStatePatches(message, patches);

    expect(result.calendarEventUids).toEqual(["event-2"]);
    expect(result.calendarInviteStates).toEqual([
      {
        eventUid: "event-2",
        actionType: "invitation",
        processedAtMs: 5678,
        processedAutomatically: true
      }
    ]);
  });
});
