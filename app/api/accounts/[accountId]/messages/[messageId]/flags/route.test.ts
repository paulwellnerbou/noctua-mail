import { describe, expect, it } from "bun:test";
import { buildFlagMutations } from "@/lib/messageFlagMutation";

describe("buildFlagMutations", () => {
  it("adds seen when answered is enabled", () => {
    expect(buildFlagMutations({ flag: "answered", value: true })).toEqual([
      { flag: "\\Answered", value: true },
      { flag: "\\Seen", value: true }
    ]);
  });

  it("does not add seen when answered is disabled", () => {
    expect(buildFlagMutations({ flag: "answered", value: false })).toEqual([
      { flag: "\\Answered", value: false }
    ]);
  });

  it("prefers keyword mutations", () => {
    expect(buildFlagMutations({ flag: "answered", keyword: " $Forwarded ", value: true })).toEqual([
      { flag: "$Forwarded", value: true }
    ]);
  });
});
