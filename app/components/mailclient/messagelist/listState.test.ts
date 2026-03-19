import { describe, expect, it } from "bun:test";
import { mergeCollapsedGroupsWithMeta } from "./listState";

describe("mergeCollapsedGroupsWithMeta", () => {
  it("preserves synthetic topic suggestion groups across server meta refreshes", () => {
    expect(
      mergeCollapsedGroupsWithMeta(
        {
          Today: false,
          "topic-suggestions:topic-build": true
        },
        [{ key: "Today", label: "Today", count: 3 }]
      )
    ).toEqual({
      Today: false,
      "topic-suggestions:topic-build": true
    });
  });
});
