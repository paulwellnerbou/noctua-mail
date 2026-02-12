import { describe, expect, it } from "bun:test";
import { mergeLoadedMessageCount, resolveLoadedMessageCount } from "./listCount";

describe("list count helpers", () => {
  it("uses baseCount for page 1 when thread payload contains extra expanded messages", () => {
    expect(
      mergeLoadedMessageCount({
        page: 1,
        previousCount: 0,
        itemCount: 63,
        baseCount: 33
      })
    ).toBe(33);
  });

  it("accumulates baseCount across pages", () => {
    expect(
      mergeLoadedMessageCount({
        page: 2,
        previousCount: 33,
        itemCount: 40,
        baseCount: 12
      })
    ).toBe(45);
  });

  it("falls back to item count when baseCount is absent", () => {
    expect(
      mergeLoadedMessageCount({
        page: 1,
        previousCount: 0,
        itemCount: 20
      })
    ).toBe(20);
  });

  it("resolves single-page counts from baseCount when provided", () => {
    expect(resolveLoadedMessageCount(63, 33)).toBe(33);
    expect(resolveLoadedMessageCount(63)).toBe(63);
  });
});
