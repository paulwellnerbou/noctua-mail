import { describe, expect, it } from "bun:test";
import { computeToggleAllGroupsState, mergeCollapsedGroupsWithMeta } from "./listState";

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

describe("computeToggleAllGroupsState", () => {
  it("collapses every key from groupMeta when any visible group is open", () => {
    const result = computeToggleAllGroupsState({
      groupMeta: [
        { key: "alice@example.com" },
        { key: "bob@example.com" },
        { key: "carol@example.com" }
      ],
      combinedGroups: [
        { key: "alice@example.com" } // only the first sender has loaded messages
      ],
      collapsedGroups: {}
    });
    expect(result).toEqual({
      "alice@example.com": true,
      "bob@example.com": true,
      "carol@example.com": true
    });
  });

  it("expands every key from groupMeta when every visible group is collapsed", () => {
    const result = computeToggleAllGroupsState({
      groupMeta: [{ key: "alice@example.com" }, { key: "bob@example.com" }],
      combinedGroups: [{ key: "alice@example.com" }],
      collapsedGroups: { "alice@example.com": true, "bob@example.com": true }
    });
    expect(result).toEqual({
      "alice@example.com": false,
      "bob@example.com": false
    });
  });

  it("treats topic-suggestion groups as collapsed by default when deciding direction", () => {
    const result = computeToggleAllGroupsState({
      groupMeta: [{ key: "Today" }],
      combinedGroups: [
        { key: "topic-suggestions:foo", variant: "topic-suggestions" },
        { key: "Today" }
      ],
      collapsedGroups: { Today: true }
    });
    // Today is collapsed, suggestion default-collapsed → nothing is open → action expands.
    expect(result.Today).toBe(false);
  });

  it("includes keys present only in combinedGroups (e.g. Flagged) even if absent from meta", () => {
    const result = computeToggleAllGroupsState({
      groupMeta: [{ key: "alice@example.com" }],
      combinedGroups: [{ key: "Flagged" }, { key: "alice@example.com" }],
      collapsedGroups: {}
    });
    expect(result).toEqual({
      "alice@example.com": true,
      Flagged: true
    });
  });
});
