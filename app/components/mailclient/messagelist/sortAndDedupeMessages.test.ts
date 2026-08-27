import { describe, expect, test } from "bun:test";
import type { Message } from "@/lib/data";
import {
  dedupeAccountMessages,
  sortMessages
} from "./sortAndDedupeMessages";

function makeMessage(overrides: Partial<Message> & { id: string }): Message {
  return {
    threadId: `thread-${overrides.id}`,
    subject: "Subject",
    from: "alice@example.com",
    to: "bob@example.com",
    preview: "",
    date: new Date(0).toISOString(),
    dateValue: 0,
    folderId: "acc:INBOX",
    accountId: "acc",
    body: "",
    ...overrides
  } as Message;
}

describe("dedupeAccountMessages", () => {
  test("empty input → empty output", () => {
    const result = dedupeAccountMessages([], "acc");
    expect(result.deduped).toEqual([]);
    expect(result.duplicates).toEqual([]);
  });

  test("filters to the requested account", () => {
    const messages = [
      makeMessage({ id: "m1", accountId: "acc-a" }),
      makeMessage({ id: "m2", accountId: "acc-b" }),
      makeMessage({ id: "m3", accountId: "acc-a" })
    ];
    const result = dedupeAccountMessages(messages, "acc-a");
    expect(result.deduped.map((m) => m.id)).toEqual(["m1", "m3"]);
    expect(result.duplicates).toEqual([]);
  });

  test("passes through when there are no duplicates", () => {
    const messages = [
      makeMessage({ id: "m1" }),
      makeMessage({ id: "m2" }),
      makeMessage({ id: "m3" })
    ];
    const result = dedupeAccountMessages(messages, "acc");
    expect(result.deduped.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(result.duplicates).toEqual([]);
  });

  test("first occurrence of an id keeps its id; later get synthetic ids", () => {
    const messages = [
      makeMessage({ id: "m1" }),
      makeMessage({ id: "m1", subject: "second" }),
      makeMessage({ id: "m2" })
    ];
    const result = dedupeAccountMessages(messages, "acc");
    expect(result.deduped.map((m) => m.id)).toEqual(["m1", "m1-1", "m2"]);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]!.originalId).toBe("m1");
    expect(result.duplicates[0]!.reassignedId).toBe("m1-1");
    // `message` is the ORIGINAL input message, pre-id-rewrite — so its id
    // is still the colliding "m1", not the synthetic "m1-1".
    expect(result.duplicates[0]!.message.id).toBe("m1");
    expect(result.duplicates[0]!.message.subject).toBe("second");
  });

  test("three copies of the same id each get distinct reassigned ids", () => {
    const messages = [
      makeMessage({ id: "m1", subject: "first" }),
      makeMessage({ id: "m1", subject: "second" }),
      makeMessage({ id: "m1", subject: "third" })
    ];
    const result = dedupeAccountMessages(messages, "acc");
    expect(result.deduped.map((m) => m.id)).toEqual(["m1", "m1-1", "m1-2"]);
    expect(result.duplicates).toHaveLength(2);
    expect(result.duplicates.map((d) => d.reassignedId)).toEqual(["m1-1", "m1-2"]);
    // Each captured `message` is the pre-rewrite input at its original
    // index — `subject` tells us which one.
    expect(result.duplicates[0]!.message.subject).toBe("second");
    expect(result.duplicates[1]!.message.subject).toBe("third");
    // Both `message.id` values are still the colliding original.
    expect(result.duplicates.every((d) => d.message.id === "m1")).toBe(true);
  });

  test("synthetic ids use index in the filtered array, not the full input", () => {
    // After filtering out foreign accounts, 'm1' duplicate should land at index 1 of the filtered list.
    const messages = [
      makeMessage({ id: "m1", accountId: "acc" }),
      makeMessage({ id: "foreign", accountId: "other" }),
      makeMessage({ id: "foreign", accountId: "other" }),
      makeMessage({ id: "m1", accountId: "acc" })
    ];
    const result = dedupeAccountMessages(messages, "acc");
    expect(result.deduped.map((m) => m.id)).toEqual(["m1", "m1-1"]);
  });

  test("preserves non-id fields on deduped messages", () => {
    const messages = [
      makeMessage({ id: "m1", subject: "First" }),
      makeMessage({ id: "m1", subject: "Second" })
    ];
    const result = dedupeAccountMessages(messages, "acc");
    expect(result.deduped[0]!.subject).toBe("First");
    expect(result.deduped[1]!.subject).toBe("Second");
    expect(result.deduped[1]!.id).toBe("m1-1");
  });

  test("does not mutate the input array", () => {
    const messages = [makeMessage({ id: "m1" }), makeMessage({ id: "m1" })];
    const snapshot = messages.map((m) => ({ ...m }));
    dedupeAccountMessages(messages, "acc");
    expect(messages).toEqual(snapshot);
  });
});

describe("sortMessages", () => {
  const oldDate = new Date("2020-01-01").getTime();
  const newDate = new Date("2025-06-15").getTime();

  test("empty input → empty output", () => {
    expect(sortMessages([], "date", "asc")).toEqual([]);
  });

  test("by date ascending (oldest first)", () => {
    const messages = [
      makeMessage({ id: "new", dateValue: newDate }),
      makeMessage({ id: "old", dateValue: oldDate })
    ];
    expect(sortMessages(messages, "date", "asc").map((m) => m.id)).toEqual([
      "old",
      "new"
    ]);
  });

  test("by date descending (newest first)", () => {
    const messages = [
      makeMessage({ id: "old", dateValue: oldDate }),
      makeMessage({ id: "new", dateValue: newDate })
    ];
    expect(sortMessages(messages, "date", "desc").map((m) => m.id)).toEqual([
      "new",
      "old"
    ]);
  });

  test("by from (alphabetical, case-aware via localeCompare)", () => {
    const messages = [
      makeMessage({ id: "m1", from: "zoe@example.com" }),
      makeMessage({ id: "m2", from: "alice@example.com" }),
      makeMessage({ id: "m3", from: "bob@example.com" })
    ];
    expect(sortMessages(messages, "from", "asc").map((m) => m.id)).toEqual([
      "m2",
      "m3",
      "m1"
    ]);
  });

  test("by subject (alphabetical)", () => {
    const messages = [
      makeMessage({ id: "m1", subject: "Zebra" }),
      makeMessage({ id: "m2", subject: "Apple" })
    ];
    expect(sortMessages(messages, "subject", "asc").map((m) => m.id)).toEqual([
      "m2",
      "m1"
    ]);
  });

  test("descending direction flips comparison for non-date keys too", () => {
    const messages = [
      makeMessage({ id: "m1", from: "alice@example.com" }),
      makeMessage({ id: "m2", from: "zoe@example.com" })
    ];
    expect(sortMessages(messages, "from", "desc").map((m) => m.id)).toEqual([
      "m2",
      "m1"
    ]);
  });

  test("is stable — messages with equal sort keys preserve input order", () => {
    // All same dateValue; stable sort must keep m1, m2, m3 in input order.
    const messages = [
      makeMessage({ id: "m1", dateValue: 100 }),
      makeMessage({ id: "m2", dateValue: 100 }),
      makeMessage({ id: "m3", dateValue: 100 })
    ];
    expect(sortMessages(messages, "date", "asc").map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "m3"
    ]);
    expect(sortMessages(messages, "date", "desc").map((m) => m.id)).toEqual([
      "m1",
      "m2",
      "m3"
    ]);
  });

  test("by size descending (largest first)", () => {
    const messages = [
      makeMessage({ id: "small", sizeBytes: 1_024 }),
      makeMessage({ id: "huge", sizeBytes: 9_000_000 }),
      makeMessage({ id: "medium", sizeBytes: 64_000 })
    ];
    expect(sortMessages(messages, "size", "desc").map((m) => m.id)).toEqual([
      "huge",
      "medium",
      "small"
    ]);
  });

  test("by size — messages with no recorded size rank last when descending", () => {
    const messages = [
      makeMessage({ id: "unknown" }),
      makeMessage({ id: "tiny", sizeBytes: 1 })
    ];
    expect(sortMessages(messages, "size", "desc").map((m) => m.id)).toEqual([
      "tiny",
      "unknown"
    ]);
  });

  test("by size — equal sizes fall back to date", () => {
    const messages = [
      makeMessage({ id: "older", sizeBytes: 500, dateValue: oldDate }),
      makeMessage({ id: "newer", sizeBytes: 500, dateValue: newDate })
    ];
    expect(sortMessages(messages, "size", "desc").map((m) => m.id)).toEqual([
      "newer",
      "older"
    ]);
  });

  test("does not mutate the input array", () => {
    const messages = [
      makeMessage({ id: "m1", dateValue: newDate }),
      makeMessage({ id: "m2", dateValue: oldDate })
    ];
    const snapshot = messages.map((m) => m.id);
    sortMessages(messages, "date", "asc");
    expect(messages.map((m) => m.id)).toEqual(snapshot);
  });
});
