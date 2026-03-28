import { describe, expect, test } from "bun:test";
import type { Message } from "./data";
import { AI_MODIFIED_FLAG } from "./messageFlags";
import { mergeLocalOnlyMessageState } from "./messageLocalState";

function buildMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    accountId: "acc-1",
    folderId: "acc-1:Drafts",
    threadId: "thread-1",
    messageId: "<msg-1@example.test>",
    subject: "Draft",
    from: "sender@example.test",
    to: "owner@example.test",
    preview: "Draft",
    date: new Date(Date.UTC(2026, 2, 28, 10, 0, 0)).toISOString(),
    dateValue: Date.UTC(2026, 2, 28, 10, 0, 0),
    body: "Draft body",
    flags: ["\\Draft", "\\Seen"],
    ...overrides
  };
}

describe("mergeLocalOnlyMessageState", () => {
  test("preserves local-only flags and draft-local metadata", () => {
    const existing = buildMessage({
      flags: ["\\Draft", "\\Seen", AI_MODIFIED_FLAG],
      xComposeFormat: "html",
      quotedHtmlEdited: true,
      draftInvite: {
        location: "Room 1",
        start: "2026-03-28T10:00",
        end: "2026-03-28T11:00",
        allDay: false,
        recurrenceRule: ""
      },
      topics: [{
        id: "topic-1",
        accountId: "acc-1",
        name: "Alpha",
        color: "blue",
        imapKeyword: "alpha",
        createdAt: 1,
        updatedAt: 1
      }],
      topicSuggestions: [{
        id: "topic-2",
        accountId: "acc-1",
        name: "Beta",
        color: "green",
        imapKeyword: "beta",
        createdAt: 1,
        updatedAt: 1
      }]
    });
    const next = buildMessage({
      flags: ["\\Draft", "\\Seen"],
      xComposeFormat: undefined,
      quotedHtmlEdited: undefined,
      draftInvite: undefined,
      topics: undefined,
      topicSuggestions: undefined
    });

    const merged = mergeLocalOnlyMessageState(next, existing);

    expect(merged.flags).toContain(AI_MODIFIED_FLAG);
    expect(merged.xComposeFormat).toBe("html");
    expect(merged.quotedHtmlEdited).toBe(true);
    expect(merged.draftInvite).toEqual(existing.draftInvite);
    expect(merged.topics).toEqual(existing.topics);
    expect(merged.topicSuggestions).toEqual(existing.topicSuggestions);
  });
});
