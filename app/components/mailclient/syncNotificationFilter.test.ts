import { describe, expect, test } from "bun:test";
import {
  pickKeysToEvict,
  planNewMailNotifications,
  type IncomingMailItem
} from "./syncNotificationFilter";

const neverSuppress = () => false;

function mkItem(overrides: Partial<IncomingMailItem> & { uid: number }): IncomingMailItem {
  return { ...overrides };
}

describe("planNewMailNotifications", () => {
  test("returns none for empty input", () => {
    const result = planNewMailNotifications({
      items: [],
      lastNotifiedUid: 10,
      notifiedKeys: new Set(),
      isNotificationSuppressedFolder: neverSuppress
    });
    expect(result.dispatch.kind).toBe("none");
    expect(result.nextLastNotifiedUid).toBeNull();
  });

  test("on first run records max uid but does not notify", () => {
    const result = planNewMailNotifications({
      items: [mkItem({ uid: 5 }), mkItem({ uid: 7 })],
      lastNotifiedUid: null,
      notifiedKeys: new Set(),
      isNotificationSuppressedFolder: neverSuppress
    });
    expect(result.dispatch.kind).toBe("none");
    expect(result.nextLastNotifiedUid).toBe(7);
    expect(result.keysToAdd).toEqual([]);
  });

  test("ignores items with non-finite uids so NaN can't poison maxUid", () => {
    // Without a Number.isFinite filter, `Math.max(...uids)` returns NaN
    // as soon as one bad item slips in, which then fails every
    // comparison and suppresses every subsequent notification and
    // high-water-mark advance.
    const result = planNewMailNotifications({
      items: [
        mkItem({ uid: 15 }),
        mkItem({ uid: Number.NaN }),
        mkItem({ uid: Number.POSITIVE_INFINITY }),
        mkItem({ uid: 18 })
      ],
      lastNotifiedUid: 10,
      notifiedKeys: new Set(),
      isNotificationSuppressedFolder: neverSuppress
    });
    expect(result.nextLastNotifiedUid).toBe(18);
    expect(result.dispatch.kind).not.toBe("none");
  });

  test("skips folder-suppressed items before even consulting lastNotifiedUid", () => {
    const result = planNewMailNotifications({
      items: [mkItem({ uid: 11, folderId: "spam", subject: "x" })],
      lastNotifiedUid: 10,
      notifiedKeys: new Set(),
      isNotificationSuppressedFolder: (id) => id === "spam"
    });
    expect(result.dispatch.kind).toBe("none");
    expect(result.nextLastNotifiedUid).toBeNull();
  });

  test("advances lastNotifiedUid when all new items are filtered out by uid", () => {
    const result = planNewMailNotifications({
      items: [mkItem({ uid: 11 }), mkItem({ uid: 12 })],
      lastNotifiedUid: 20,
      notifiedKeys: new Set(),
      isNotificationSuppressedFolder: neverSuppress
    });
    // maxUid (12) < lastNotified (20), so no update
    expect(result.dispatch.kind).toBe("none");
    expect(result.nextLastNotifiedUid).toBeNull();
  });

  test("drops self-sent messages when accountEmail matches", () => {
    const result = planNewMailNotifications({
      items: [
        mkItem({ uid: 11, from: "Me <me@example.com>", subject: "my own" }),
        mkItem({ uid: 12, from: "Other <other@example.com>", subject: "new" })
      ],
      lastNotifiedUid: 10,
      notifiedKeys: new Set(),
      isNotificationSuppressedFolder: neverSuppress,
      accountEmail: "me@example.com"
    });
    expect(result.dispatch.kind).toBe("single");
    if (result.dispatch.kind === "single") {
      expect(result.dispatch.title).toBe("new");
    }
    expect(result.nextLastNotifiedUid).toBe(12);
  });

  test("drops newsletter category items", () => {
    const result = planNewMailNotifications({
      items: [
        mkItem({ uid: 11, subject: "ad", category: "newsletter" }),
        mkItem({ uid: 12, subject: "real" })
      ],
      lastNotifiedUid: 10,
      notifiedKeys: new Set(),
      isNotificationSuppressedFolder: neverSuppress
    });
    expect(result.dispatch.kind).toBe("single");
    if (result.dispatch.kind === "single") {
      expect(result.dispatch.title).toBe("real");
    }
  });

  test("dedups against the notifiedKeys ring by messageId", () => {
    const result = planNewMailNotifications({
      items: [
        mkItem({ uid: 11, messageId: "abc", subject: "dup" }),
        mkItem({ uid: 12, messageId: "def", subject: "new" })
      ],
      lastNotifiedUid: 10,
      notifiedKeys: new Set(["abc"]),
      isNotificationSuppressedFolder: neverSuppress
    });
    expect(result.dispatch.kind).toBe("single");
    if (result.dispatch.kind === "single") {
      expect(result.dispatch.title).toBe("new");
    }
    expect(result.keysToAdd).toEqual(["def"]);
  });

  test("falls back to uid-key when messageId is missing", () => {
    const result = planNewMailNotifications({
      items: [mkItem({ uid: 42, subject: "hi" })],
      lastNotifiedUid: 10,
      notifiedKeys: new Set(),
      isNotificationSuppressedFolder: neverSuppress
    });
    expect(result.keysToAdd).toEqual(["uid:42"]);
  });

  test("emits batch dispatch with subject preview when multiple unique items", () => {
    const result = planNewMailNotifications({
      items: [
        mkItem({ uid: 11, subject: "one" }),
        mkItem({ uid: 12, subject: "two" }),
        mkItem({ uid: 13, subject: "three" }),
        mkItem({ uid: 14, subject: "four" })
      ],
      lastNotifiedUid: 10,
      notifiedKeys: new Set(),
      isNotificationSuppressedFolder: neverSuppress
    });
    expect(result.dispatch.kind).toBe("batch");
    if (result.dispatch.kind === "batch") {
      expect(result.dispatch.title).toBe("4 new messages");
      expect(result.dispatch.body).toBe("one • two • three");
    }
    expect(result.nextLastNotifiedUid).toBe(14);
  });

  test("evicts oldest keys when the ring exceeds the cap", () => {
    const existing = new Set<string>();
    for (let i = 0; i < 199; i += 1) existing.add(`old${i}`);
    const result = planNewMailNotifications({
      items: [
        mkItem({ uid: 1000, subject: "a", messageId: "a" }),
        mkItem({ uid: 1001, subject: "b", messageId: "b" })
      ],
      lastNotifiedUid: 10,
      notifiedKeys: existing,
      isNotificationSuppressedFolder: neverSuppress,
      maxNotifiedKeys: 200,
      evictBatchSize: 50
    });
    expect(result.keysToEvict.length).toBe(50);
    expect(result.keysToEvict[0]).toBe("old0");
  });
});

describe("pickKeysToEvict", () => {
  test("returns empty when additions keep size under the cap", () => {
    const keys = new Set(["a", "b"]);
    expect(pickKeysToEvict(keys, ["c"], 10, 2)).toEqual([]);
  });

  test("returns up to batchSize oldest keys when the cap is exceeded", () => {
    const keys = new Set(["a", "b", "c"]);
    expect(pickKeysToEvict(keys, ["d", "e"], 3, 2)).toEqual(["a", "b"]);
  });

  test("dedupes additions so duplicates don't inflate the projected size", () => {
    const keys = new Set(["a", "b"]);
    // Three entries but only one distinct new key → projected size 3,
    // still within the cap of 3. A naive `additions.filter(…).length`
    // would count 3 and start evicting.
    expect(pickKeysToEvict(keys, ["c", "c", "c"], 3, 2)).toEqual([]);
  });

  test("ignores additions that are already present in the ring", () => {
    const keys = new Set(["a", "b"]);
    // `a` is already in the ring, so the addition is a no-op; projected
    // size stays at 2, well under the cap.
    expect(pickKeysToEvict(keys, ["a", "a"], 2, 2)).toEqual([]);
  });
});
