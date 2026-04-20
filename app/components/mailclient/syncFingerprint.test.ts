import { describe, expect, test } from "bun:test";
import { getResolvedRemoteMailboxFingerprint } from "./syncFingerprint";

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

  test("fills missing remote fields with null", () => {
    const fingerprint = getResolvedRemoteMailboxFingerprint({
      needsRepair: false,
      remote: {
        count: null,
        uidNext: null,
        uidValidity: null,
        highestModSeq: null
      }
    });

    expect(fingerprint).toBe(
      JSON.stringify({
        count: null,
        uidNext: null,
        uidValidity: null,
        highestModSeq: null
      })
    );
  });

  test("treats a missing remote block as an all-null snapshot", () => {
    const fingerprint = getResolvedRemoteMailboxFingerprint({
      needsRepair: false
    });

    expect(fingerprint).toBe(
      JSON.stringify({
        count: null,
        uidNext: null,
        uidValidity: null,
        highestModSeq: null
      })
    );
  });

  test("returns distinct fingerprints for different snapshots", () => {
    const a = getResolvedRemoteMailboxFingerprint({
      needsRepair: false,
      remote: {
        count: 1,
        uidNext: 2,
        uidValidity: "v",
        highestModSeq: "m"
      }
    });
    const b = getResolvedRemoteMailboxFingerprint({
      needsRepair: false,
      remote: {
        count: 1,
        uidNext: 3,
        uidValidity: "v",
        highestModSeq: "m"
      }
    });
    expect(a).not.toBe(b);
  });
});
