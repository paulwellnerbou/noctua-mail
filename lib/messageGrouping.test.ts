import { describe, expect, it } from "bun:test";
import {
  buildTimeGroupKey,
  buildInviteDeckGroupKeyFromEvent,
  DATE_GROUP_ORDER,
  INVITE_DECK_GROUP_BY,
  INVITE_DECK_GROUP_ORDER,
  sortGroupsForGroupBy
} from "./messageGrouping";

function localDateMs(year: number, monthIndex: number, day: number, hour = 0) {
  return new Date(year, monthIndex, day, hour).getTime();
}

describe("buildTimeGroupKey", () => {
  const nowMs = localDateMs(2026, 1, 28, 12);

  it("keeps invite deck grouped into UPCOMING and PAST", () => {
    expect(buildTimeGroupKey(localDateMs(2026, 1, 28, 9), INVITE_DECK_GROUP_BY, nowMs)).toBe(
      "UPCOMING"
    );
    expect(buildTimeGroupKey(localDateMs(2026, 2, 2, 9), INVITE_DECK_GROUP_BY, nowMs)).toBe(
      "UPCOMING"
    );
    expect(buildTimeGroupKey(localDateMs(2026, 1, 27, 23), INVITE_DECK_GROUP_BY, nowMs)).toBe(
      "PAST"
    );
  });

  it("keeps standard date grouping unchanged", () => {
    expect(buildTimeGroupKey(localDateMs(2026, 1, 28, 9), "date", nowMs)).toBe("Today");
    expect(buildTimeGroupKey(localDateMs(2026, 1, 27, 12), "date", nowMs)).toBe("Yesterday");
    expect(buildTimeGroupKey(localDateMs(2026, 1, 24, 12), "date", nowMs)).toBe("This Week");
    expect(buildTimeGroupKey(localDateMs(2026, 1, 10, 12), "date", nowMs)).toBe("Older");
  });
});

describe("sortGroupsForGroupBy", () => {
  it("sorts invite deck buckets as UPCOMING then PAST", () => {
    const groups = sortGroupsForGroupBy(
      [{ key: "PAST" }, { key: "UPCOMING" }],
      INVITE_DECK_GROUP_BY
    );
    expect(groups.map((group) => group.key)).toEqual([...INVITE_DECK_GROUP_ORDER]);
  });

  it("sorts standard date buckets with the existing order", () => {
    const groups = sortGroupsForGroupBy(
      [{ key: "Older" }, { key: "Today" }, { key: "This Week" }, { key: "Yesterday" }],
      "date"
    );
    expect(groups.map((group) => group.key)).toEqual([...DATE_GROUP_ORDER]);
  });
});

describe("buildInviteDeckGroupKeyFromEvent", () => {
  const nowMs = localDateMs(2026, 1, 28, 12);

  it("treats recurring events with future instances as UPCOMING", () => {
    expect(
      buildInviteDeckGroupKeyFromEvent(
        {
          eventStartAtMs: localDateMs(2026, 1, 1, 9),
          eventEndAtMs: localDateMs(2026, 1, 1, 10),
          recurrenceRule: "FREQ=WEEKLY"
        },
        nowMs
      )
    ).toBe("UPCOMING");
  });

  it("treats in-progress events as UPCOMING", () => {
    expect(
      buildInviteDeckGroupKeyFromEvent(
        {
          eventStartAtMs: localDateMs(2026, 1, 28, 11),
          eventEndAtMs: localDateMs(2026, 1, 28, 13)
        },
        nowMs
      )
    ).toBe("UPCOMING");
  });

  it("treats ended one-off events as PAST", () => {
    expect(
      buildInviteDeckGroupKeyFromEvent(
        {
          eventStartAtMs: localDateMs(2026, 1, 27, 9),
          eventEndAtMs: localDateMs(2026, 1, 27, 10)
        },
        nowMs
      )
    ).toBe("PAST");
  });
});
