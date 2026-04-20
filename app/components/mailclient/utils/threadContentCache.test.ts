import { describe, expect, it } from "bun:test";
import type { Message } from "@/lib/data";
import {
  evictMessagesFromThreadCacheMap,
  updateThreadCacheMapWithCategory,
  updateThreadCacheMapWithFlags,
  updateThreadCacheWithMessageMap,
  upsertThreadInCache
} from "./threadContentCache";

function makeMessage(overrides?: Partial<Message>): Message {
  return {
    id: "m1",
    threadId: "t1",
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

describe("upsertThreadInCache", () => {
  it("inserts a new thread and appends to the LRU order", () => {
    const { next, order } = upsertThreadInCache({}, [], "t1", [makeMessage()], 5);
    expect(next.t1).toHaveLength(1);
    expect(order).toEqual(["t1"]);
  });

  it("moves an existing thread to the end of the order when re-upserted", () => {
    const { next, order } = upsertThreadInCache(
      { t1: [makeMessage({ id: "m1" })], t2: [makeMessage({ id: "m2", threadId: "t2" })] },
      ["t1", "t2"],
      "t1",
      [makeMessage({ id: "m1b" })],
      5
    );
    expect(order).toEqual(["t2", "t1"]);
    expect(next.t1[0].id).toBe("m1b");
  });

  it("evicts the oldest thread when the limit is exceeded", () => {
    const { next, order } = upsertThreadInCache(
      {
        a: [makeMessage({ id: "a" })],
        b: [makeMessage({ id: "b" })]
      },
      ["a", "b"],
      "c",
      [makeMessage({ id: "c" })],
      2
    );
    expect(order).toEqual(["b", "c"]);
    expect(Object.keys(next).sort()).toEqual(["b", "c"]);
  });
});

describe("updateThreadCacheWithMessageMap", () => {
  it("returns the previous map unchanged when the thread is not cached", () => {
    const prev = { t1: [makeMessage({ id: "m1" })] };
    const result = updateThreadCacheWithMessageMap(prev, makeMessage({ id: "m9", threadId: "t9" }));
    expect(result).toBe(prev);
  });

  it("merges a hydrated message onto its cached entry and preserves groupKey", () => {
    const prev = {
      t1: [makeMessage({ id: "m1", subject: "old", groupKey: "Today" })]
    };
    const result = updateThreadCacheWithMessageMap(
      prev,
      makeMessage({ id: "m1", subject: "new", groupKey: undefined })
    );
    expect(result.t1[0].subject).toBe("new");
    expect(result.t1[0].groupKey).toBe("Today");
  });

  it("appends a message not yet in the cached thread", () => {
    const prev = { t1: [makeMessage({ id: "m1" })] };
    const result = updateThreadCacheWithMessageMap(prev, makeMessage({ id: "m2", threadId: "t1" }));
    expect(result.t1).toHaveLength(2);
    expect(result.t1[1].id).toBe("m2");
  });
});

describe("evictMessagesFromThreadCacheMap", () => {
  it("reports no change when nothing matches", () => {
    const prev = { t1: [makeMessage({ id: "m1" })] };
    const { next, changed } = evictMessagesFromThreadCacheMap(prev, ["x"]);
    expect(changed).toBe(false);
    expect(next).toBe(prev);
  });

  it("drops matching ids and removes empty threads", () => {
    const prev = {
      t1: [makeMessage({ id: "m1" }), makeMessage({ id: "m2" })],
      t2: [makeMessage({ id: "m3", threadId: "t2" })]
    };
    const { next, changed } = evictMessagesFromThreadCacheMap(prev, ["m2", "m3"]);
    expect(changed).toBe(true);
    expect(next.t1).toHaveLength(1);
    expect(next.t1[0].id).toBe("m1");
    expect(next.t2).toBeUndefined();
  });
});

describe("updateThreadCacheMapWithFlags", () => {
  it("returns the previous map when the message id is not cached", () => {
    const prev = { t1: [makeMessage({ id: "m1" })] };
    const result = updateThreadCacheMapWithFlags(prev, "absent", ["\\Seen"]);
    expect(result).toBe(prev);
  });

  it("applies the flag set to the matching cached message", () => {
    const prev = { t1: [makeMessage({ id: "m1", seen: false, unread: true })] };
    const result = updateThreadCacheMapWithFlags(prev, "m1", ["\\Seen"]);
    expect(result.t1[0].seen).toBe(true);
    expect(result.t1[0].unread).toBe(false);
    expect(result.t1[0].flags).toEqual(["\\Seen"]);
  });
});

describe("updateThreadCacheMapWithCategory", () => {
  it("returns the previous map when the message id is not cached", () => {
    const prev = { t1: [makeMessage({ id: "m1" })] };
    const result = updateThreadCacheMapWithCategory(prev, "nope", "promotional", 0.5, null);
    expect(result).toBe(prev);
  });

  it("replaces the category triple on the matching cached message", () => {
    const prev = {
      t1: [makeMessage({ id: "m1" }), makeMessage({ id: "m2" })]
    };
    const result = updateThreadCacheMapWithCategory(
      prev,
      "m2",
      "personal",
      0.9,
      { reasons: ["reply"] } as unknown as Message["categorySignals"]
    );
    expect(result.t1[1].category).toBe("personal");
    expect(result.t1[1].categoryScore).toBe(0.9);
    expect(result.t1[0].category).toBeUndefined();
  });
});
