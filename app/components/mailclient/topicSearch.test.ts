import { describe, expect, it } from "bun:test";
import { parseSimpleTopicSearchMode } from "./topicSearch";

describe("parseSimpleTopicSearchMode", () => {
  it("returns the topic id for a bare topic query", () => {
    expect(parseSimpleTopicSearchMode("topic:build-alerts")).toEqual({
      topicId: "build-alerts"
    });
  });

  it("rejects topic queries with extra free text", () => {
    expect(parseSimpleTopicSearchMode("topic:build-alerts regression")).toBeNull();
  });

  it("rejects multiple topic terms", () => {
    expect(parseSimpleTopicSearchMode("topic:one topic:two")).toBeNull();
  });

  it("supports quoted topic ids", () => {
    expect(parseSimpleTopicSearchMode('topic:"build alerts"')).toEqual({
      topicId: "build alerts"
    });
  });

  it("recognises topic:none as the no-topic filter", () => {
    expect(parseSimpleTopicSearchMode("topic:none")).toEqual({
      topicId: "none",
      noTopicFilter: true
    });
  });

  it("normalises case for the no-topic sentinel", () => {
    expect(parseSimpleTopicSearchMode("topic:NONE")).toEqual({
      topicId: "none",
      noTopicFilter: true
    });
    expect(parseSimpleTopicSearchMode("topic:None")).toEqual({
      topicId: "none",
      noTopicFilter: true
    });
  });
});
