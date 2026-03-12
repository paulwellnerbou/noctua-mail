import { describe, expect, it } from "bun:test";
import type { Message } from "@/lib/data";
import { reconcileSavedDraftMessages } from "./draftListState";

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: overrides.id ?? "message-1",
    threadId: overrides.threadId ?? "thread-1",
    subject: overrides.subject ?? "Subject",
    from: overrides.from ?? "Alice <alice@example.com>",
    to: overrides.to ?? "Bob <bob@example.com>",
    preview: overrides.preview ?? "Preview",
    date: overrides.date ?? new Date(0).toISOString(),
    dateValue: overrides.dateValue ?? 0,
    folderId: overrides.folderId ?? "folder-1",
    accountId: overrides.accountId ?? "account-1",
    body: overrides.body ?? "Body",
    ...overrides
  };
}

describe("reconcileSavedDraftMessages", () => {
  it("replaces the previous draft row with the saved draft", () => {
    const original = makeMessage({ id: "draft-old", subject: "Old subject" });
    const saved = makeMessage({ id: "draft-new", subject: "New subject", dateValue: 2 });
    const untouched = makeMessage({ id: "message-2", subject: "Other" });

    const result = reconcileSavedDraftMessages({
      messages: [original, untouched],
      savedDraft: saved,
      previousDraftId: "draft-old",
      includeSavedDraft: true
    });

    expect(result).toEqual([untouched, saved]);
  });

  it("removes stale draft rows when the saved draft no longer belongs in the current results", () => {
    const original = makeMessage({ id: "draft-old" });
    const saved = makeMessage({ id: "draft-new" });

    const result = reconcileSavedDraftMessages({
      messages: [original],
      savedDraft: saved,
      previousDraftId: "draft-old",
      includeSavedDraft: false
    });

    expect(result).toEqual([]);
  });
});
