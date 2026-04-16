import { describe, expect, test } from "bun:test";

import { determineFolderConsistency } from "@/lib/syncPolicy";

describe("determineFolderConsistency", () => {
  test("prefers repair for count-only mismatch", () => {
    const result = determineFolderConsistency({
      remote: {
        count: 10,
        uidNext: 21,
        uidValidity: "1",
        highestModSeq: null
      },
      local: {
        count: 9,
        highestUid: 20,
        uidValidity: "1",
        highestModSeq: null,
        supportsQresync: false
      }
    });

    expect(result.needsRepair).toBe(true);
    expect(result.recommendedMode).toBe("repair");
    expect(result.reasons).toEqual(["count-mismatch"]);
  });

  test("keeps full sync for uid validity mismatch", () => {
    const result = determineFolderConsistency({
      remote: {
        count: 10,
        uidNext: 21,
        uidValidity: "2",
        highestModSeq: null
      },
      local: {
        count: 10,
        highestUid: 20,
        uidValidity: "1",
        highestModSeq: null,
        supportsQresync: false
      }
    });

    expect(result.needsRepair).toBe(true);
    expect(result.recommendedMode).toBe("full");
    expect(result.reasons).toEqual(["uid-validity-mismatch"]);
  });

  test("skips count-based repair when qresync state is unchanged", () => {
    const result = determineFolderConsistency({
      remote: {
        count: 15,
        uidNext: 31,
        uidValidity: "1",
        highestModSeq: "500"
      },
      local: {
        count: 12,
        highestUid: 30,
        uidValidity: "1",
        highestModSeq: "500",
        supportsQresync: true
      }
    });

    expect(result.needsRepair).toBe(false);
    expect(result.recommendedMode).toBe("none");
    expect(result.reasons).toEqual([]);
  });
});
