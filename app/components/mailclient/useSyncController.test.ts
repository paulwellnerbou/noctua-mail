import { describe, expect, test } from "bun:test";
import { getResolvedRemoteMailboxFingerprint } from "./useSyncController";

describe("getResolvedRemoteMailboxFingerprint", () => {
  test("returns a fingerprint when no repair is needed", () => {
    const fingerprint = getResolvedRemoteMailboxFingerprint({
      needsRepair: false,
      remote: {
        count: 865,
        uidNext: 77874,
        uidValidity: "1305058745",
        highestModSeq: null
      }
    });

    expect(fingerprint).toBe(
      JSON.stringify({
        count: 865,
        uidNext: 77874,
        uidValidity: "1305058745",
        highestModSeq: null
      })
    );
  });

  test("does not treat an unchanged remote state as resolved while repair is still needed", () => {
    const fingerprint = getResolvedRemoteMailboxFingerprint({
      needsRepair: true,
      remote: {
        count: 865,
        uidNext: 77874,
        uidValidity: "1305058745",
        highestModSeq: null
      }
    });

    expect(fingerprint).toBeNull();
  });
});
