import { describe, expect, test } from "bun:test";
import {
  SEARCH_AUTO_SUBMIT_MIN_LENGTH,
  resolveSearchInputTransition,
  resolveSubmittedSearchQuery
} from "./searchInputPolicy";

describe("resolveSearchInputTransition", () => {
  test("one or two characters never start an automatic search", () => {
    expect(resolveSearchInputTransition("e", "")).toEqual({ type: "none" });
    expect(resolveSearchInputTransition("eb", "")).toEqual({ type: "none" });
    expect(resolveSearchInputTransition("  eb ", "")).toEqual({ type: "none" });
  });

  test("the threshold schedules the trimmed query", () => {
    expect(SEARCH_AUTO_SUBMIT_MIN_LENGTH).toBe(3);
    expect(resolveSearchInputTransition("eba", "")).toEqual({ type: "schedule", query: "eba" });
    expect(resolveSearchInputTransition(" rechnung ", "")).toEqual({
      type: "schedule",
      query: "rechnung"
    });
  });

  test("input that already matches the applied query changes nothing", () => {
    expect(resolveSearchInputTransition("eba", "eba")).toEqual({ type: "none" });
    expect(resolveSearchInputTransition("eba ", "eba")).toEqual({ type: "none" });
  });

  test("dropping below the threshold schedules clearing the applied query", () => {
    expect(resolveSearchInputTransition("eb", "eba")).toEqual({ type: "schedule", query: "" });
  });

  test("an empty box clears an applied query immediately", () => {
    expect(resolveSearchInputTransition("", "eba")).toEqual({ type: "apply", query: "" });
    expect(resolveSearchInputTransition("   ", "eba")).toEqual({ type: "apply", query: "" });
    expect(resolveSearchInputTransition("", "")).toEqual({ type: "none" });
  });

  test("a custom threshold is honoured", () => {
    expect(resolveSearchInputTransition("eb", "", 2)).toEqual({ type: "schedule", query: "eb" });
    expect(resolveSearchInputTransition("e", "", 2)).toEqual({ type: "none" });
  });
});

describe("resolveSubmittedSearchQuery", () => {
  test("Enter applies any trimmed input, including short ones", () => {
    expect(resolveSubmittedSearchQuery("e")).toBe("e");
    expect(resolveSubmittedSearchQuery(" eb ")).toBe("eb");
    expect(resolveSubmittedSearchQuery("   ")).toBe("");
  });
});
