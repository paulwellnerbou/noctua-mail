import { describe, expect, it } from "bun:test";
import { TOPIC_NONE_SENTINEL, isTopicNoneSentinel } from "./searchSentinels";

describe("isTopicNoneSentinel", () => {
  it("matches the canonical sentinel", () => {
    expect(isTopicNoneSentinel(TOPIC_NONE_SENTINEL)).toBe(true);
  });

  it("matches regardless of case", () => {
    expect(isTopicNoneSentinel("NONE")).toBe(true);
    expect(isTopicNoneSentinel("None")).toBe(true);
    expect(isTopicNoneSentinel("nOnE")).toBe(true);
  });

  it("rejects unrelated values", () => {
    expect(isTopicNoneSentinel("")).toBe(false);
    expect(isTopicNoneSentinel("nones")).toBe(false);
    expect(isTopicNoneSentinel("work-abc12345")).toBe(false);
    expect(isTopicNoneSentinel(null)).toBe(false);
    expect(isTopicNoneSentinel(undefined)).toBe(false);
  });
});
