import { describe, expect, test } from "bun:test";
import { isThreadsScopeAvailable } from "./messageListViewTypes";

describe("isThreadsScopeAvailable", () => {
  test("is available in a real folder scope", () => {
    expect(isThreadsScopeAvailable({ searchScope: "folder" })).toBe(true);
  });

  test("is available for scoped all-search contexts", () => {
    expect(isThreadsScopeAvailable({ searchScope: "all", activeTopicId: "topic-1" })).toBe(true);
    expect(isThreadsScopeAvailable({ searchScope: "all", activeVirtualFolderId: "virtual:focused" })).toBe(true);
  });

  test("is unavailable for plain everywhere search", () => {
    expect(isThreadsScopeAvailable({ searchScope: "all" })).toBe(false);
  });
});
