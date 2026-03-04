import { describe, expect, it } from "bun:test";
import {
  DEFAULT_THREAD_DATE_SOURCE,
  isThreadDateSensitiveGroupBy,
  normalizeThreadDateSource
} from "./threadDate";

describe("normalizeThreadDateSource", () => {
  it("defaults to latestReceivedDateValue", () => {
    expect(normalizeThreadDateSource()).toBe(DEFAULT_THREAD_DATE_SOURCE);
    expect(normalizeThreadDateSource("")).toBe(DEFAULT_THREAD_DATE_SOURCE);
    expect(normalizeThreadDateSource("unknown")).toBe(DEFAULT_THREAD_DATE_SOURCE);
  });

  it("preserves the latest activity source", () => {
    expect(normalizeThreadDateSource("latestDateValue")).toBe("latestDateValue");
  });
});

describe("isThreadDateSensitiveGroupBy", () => {
  it("enables alternate thread dates for date-derived groups only", () => {
    expect(isThreadDateSensitiveGroupBy("date")).toBe(true);
    expect(isThreadDateSensitiveGroupBy("week")).toBe(true);
    expect(isThreadDateSensitiveGroupBy("year")).toBe(true);
    expect(isThreadDateSensitiveGroupBy("sender")).toBe(false);
    expect(isThreadDateSensitiveGroupBy("folder")).toBe(false);
  });
});
