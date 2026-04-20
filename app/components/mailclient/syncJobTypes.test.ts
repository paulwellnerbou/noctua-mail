import { describe, expect, test } from "bun:test";
import {
  FullSyncDebugCancelledError,
  isFullSyncDebugCancelledError
} from "./syncJobTypes";

describe("FullSyncDebugCancelledError", () => {
  test("wraps the reason into the message", () => {
    const error = new FullSyncDebugCancelledError("user said no");
    expect(error.message).toBe("Full sync cancelled before start. Reason: user said no");
  });

  test("sets the class name so the sentinel survives bundler renaming", () => {
    const error = new FullSyncDebugCancelledError("x");
    expect(error.name).toBe("FullSyncDebugCancelledError");
  });

  test("is recognised by isFullSyncDebugCancelledError", () => {
    const error = new FullSyncDebugCancelledError("x");
    expect(isFullSyncDebugCancelledError(error)).toBe(true);
  });

  test("is recognised even when thrown across realms by name alone", () => {
    const imposter = new Error("Full sync cancelled");
    imposter.name = "FullSyncDebugCancelledError";
    expect(isFullSyncDebugCancelledError(imposter)).toBe(true);
  });

  test("rejects unrelated errors and non-error values", () => {
    expect(isFullSyncDebugCancelledError(new Error("other"))).toBe(false);
    expect(isFullSyncDebugCancelledError("string")).toBe(false);
    expect(isFullSyncDebugCancelledError(null)).toBe(false);
    expect(isFullSyncDebugCancelledError(undefined)).toBe(false);
  });
});
