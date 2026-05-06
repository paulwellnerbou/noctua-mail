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

  it("returns no mutations for an unknown flag key", () => {
    // Payloads arrive from JSON, so the `flag` field is just a string at
    // runtime; an unknown key must funnel through the empty-mutations path
    // so route handlers raise the standard "Unknown flag" error instead of
    // attempting an IMAP STORE with `undefined`.
    expect(buildFlagMutations({ flag: "bogus", value: true })).toEqual([]);
  });
});
