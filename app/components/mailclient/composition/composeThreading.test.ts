import { describe, expect, it } from "bun:test";
import { shouldThreadComposeForMode } from "./composeThreading";

describe("shouldThreadComposeForMode", () => {
  it("returns true for threadable compose modes", () => {
    expect(shouldThreadComposeForMode("reply")).toBe(true);
    expect(shouldThreadComposeForMode("replyAll")).toBe(true);
    expect(shouldThreadComposeForMode("forward")).toBe(true);
    expect(shouldThreadComposeForMode("editAsNew")).toBe(true);
    expect(shouldThreadComposeForMode("edit")).toBe(true);
  });

  it("returns false for new compose", () => {
    expect(shouldThreadComposeForMode("new")).toBe(false);
  });
});
