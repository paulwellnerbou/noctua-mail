import { describe, expect, it } from "bun:test";
import { normalizeImageDimension } from "./ImageNode";

describe("normalizeImageDimension", () => {
  it("keeps positive finite numbers", () => {
    expect(normalizeImageDimension(320)).toBe(320);
    expect(normalizeImageDimension("640")).toBe(640);
    expect(normalizeImageDimension("12.5")).toBe(12.5);
  });

  it("drops invalid numeric values", () => {
    expect(normalizeImageDimension(undefined)).toBeUndefined();
    expect(normalizeImageDimension(null)).toBeUndefined();
    expect(normalizeImageDimension("")).toBeUndefined();
    expect(normalizeImageDimension("auto")).toBeUndefined();
    expect(normalizeImageDimension("100%")).toBeUndefined();
    expect(normalizeImageDimension(Number.NaN)).toBeUndefined();
    expect(normalizeImageDimension(Infinity)).toBeUndefined();
    expect(normalizeImageDimension(0)).toBeUndefined();
    expect(normalizeImageDimension(-24)).toBeUndefined();
  });
});
