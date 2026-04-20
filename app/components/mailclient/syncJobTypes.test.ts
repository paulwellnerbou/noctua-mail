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

  test("is recognised by name + message without requiring the exact class", () => {
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

  test("rejects a bare object with the right name but no message string", () => {
    // The guard narrows to `FullSyncDebugCancelledError` (an `Error`,
    // which has `message`), so consumers can safely access
    // `error.message` after the check. Without a `message` check the
    // guard would approve name-only plain objects and leave that
    // downstream access reading `undefined`.
    expect(isFullSyncDebugCancelledError({ name: "FullSyncDebugCancelledError" })).toBe(false);
    expect(
      isFullSyncDebugCancelledError({ name: "FullSyncDebugCancelledError", message: 42 })
    ).toBe(false);
  });
});
