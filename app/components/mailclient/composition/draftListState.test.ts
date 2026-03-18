import { describe, expect, it } from "bun:test";
import type { Message } from "@/lib/data";
import {
  buildSavedDraftListMessage,
  reconcileSavedDraftMessages
} from "./draftListState";

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

  it("prunes cross-folder drafts when the active folder has no thread anchor", () => {
    const saved = makeMessage({
      id: "draft-new",
      folderId: "account-1:Drafts",
      threadId: "thread-1"
    });

    const result = reconcileSavedDraftMessages({
      messages: [],
      savedDraft: saved,
      previousDraftId: null,
      includeSavedDraft: true,
      pruneOptions: {
        searchScope: "folder",
        activeFolderId: "account-1:INBOX",
        includeThreadAcrossFoldersForList: true
      }
    });

    expect(result).toEqual([]);
  });

  it("keeps cross-folder drafts when the active folder still anchors the thread", () => {
    const inbox = makeMessage({
      id: "message-inbox",
      folderId: "account-1:INBOX",
      threadId: "thread-1"
    });
    const saved = makeMessage({
      id: "draft-new",
      folderId: "account-1:Drafts",
      threadId: "thread-1"
    });

    const result = reconcileSavedDraftMessages({
      messages: [inbox],
      savedDraft: saved,
      previousDraftId: null,
      includeSavedDraft: true,
      pruneOptions: {
        searchScope: "folder",
        activeFolderId: "account-1:INBOX",
        includeThreadAcrossFoldersForList: true
      }
    });

    expect(result).toEqual([inbox, saved]);
  });
});

describe("buildSavedDraftListMessage", () => {
  it("preserves the existing received thread sort date for saved drafts", () => {
    const inbox = makeMessage({
      id: "message-inbox",
      threadId: "thread-1",
      dateValue: new Date("2024-04-01T12:00:00.000Z").getTime(),
      threadSortDateValue: new Date("2024-04-01T12:00:00.000Z").getTime()
    });
    const savedDraft = makeMessage({
      id: "draft-new",
      threadId: "thread-1",
      dateValue: new Date("2025-04-01T12:00:00.000Z").getTime(),
      draft: true
    });

    const result = buildSavedDraftListMessage({
      messages: [inbox],
      savedDraft,
      previousDraftId: null,
      groupBy: "year",
      threadDateSource: "latestReceivedDateValue"
    });

    expect(result.threadSortDateValue).toBe(inbox.threadSortDateValue);
    expect(result.groupKey).toBe("2024");
  });

  it("keeps activity-based grouping when the active sort source is activity", () => {
    const inbox = makeMessage({
      id: "message-inbox",
      threadId: "thread-1",
      dateValue: new Date("2024-04-01T12:00:00.000Z").getTime(),
      threadSortDateValue: new Date("2024-04-01T12:00:00.000Z").getTime()
    });
    const savedDraft = makeMessage({
      id: "draft-new",
      threadId: "thread-1",
      dateValue: new Date("2025-04-01T12:00:00.000Z").getTime(),
      draft: true
    });

    const result = buildSavedDraftListMessage({
      messages: [inbox],
      savedDraft,
      previousDraftId: null,
      groupBy: "year",
      threadDateSource: "latestDateValue"
    });

    expect(result.threadSortDateValue).toBeUndefined();
    expect(result.groupKey).toBe("2025");
  });
});
