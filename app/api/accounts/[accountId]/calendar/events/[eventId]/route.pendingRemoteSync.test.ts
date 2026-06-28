import { describe, expect, test } from "bun:test";
import { resolvePendingRemoteSync } from "./route";

const NOW = 1_700_000_000_000;

describe("resolvePendingRemoteSync", () => {
  test("stamps the change time for a caldav event with a remoteHref", () => {
    expect(
      resolvePendingRemoteSync(
        { sourceType: "caldav", remoteHref: "https://caldav.example.test/cal/x.ics" },
        NOW
      )
    ).toBe(NOW);
  });

  test("leaves a local-only event unflagged", () => {
    expect(resolvePendingRemoteSync({ sourceType: "local" }, NOW)).toBeUndefined();
  });

  test("does not flag a caldav event that has not been pushed yet (no remoteHref)", () => {
    expect(resolvePendingRemoteSync({ sourceType: "caldav" }, NOW)).toBeUndefined();
  });

  test("preserves an existing pending timestamp for non-pushable events", () => {
    expect(resolvePendingRemoteSync({ sourceType: "local", pendingRemoteSync: 42 }, NOW)).toBe(42);
  });
});
