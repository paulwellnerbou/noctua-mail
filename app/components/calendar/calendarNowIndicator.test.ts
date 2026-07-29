import { describe, expect, it } from "bun:test";
import { dayElapsedFraction, msUntilNextMinute } from "./calendarNowIndicator";

describe("calendarNowIndicator.dayElapsedFraction", () => {
  it("is 0 at midnight and 0.5 at midday", () => {
    expect(dayElapsedFraction(new Date(2026, 6, 29, 0, 0, 0))).toBe(0);
    expect(dayElapsedFraction(new Date(2026, 6, 29, 12, 0, 0))).toBe(0.5);
  });

  it("counts minutes and seconds", () => {
    expect(dayElapsedFraction(new Date(2026, 6, 29, 6, 0, 0))).toBeCloseTo(0.25, 10);
    expect(dayElapsedFraction(new Date(2026, 6, 29, 10, 30, 0))).toBeCloseTo(0.4375, 10);
    expect(dayElapsedFraction(new Date(2026, 6, 29, 0, 0, 30))).toBeCloseTo(30 / 86400, 10);
  });

  it("stays below 1 at the last second of the day", () => {
    const fraction = dayElapsedFraction(new Date(2026, 6, 29, 23, 59, 59));
    expect(fraction).toBeGreaterThan(0.999);
    expect(fraction).toBeLessThan(1);
  });
});

describe("calendarNowIndicator.msUntilNextMinute", () => {
  it("counts down to the next minute boundary", () => {
    expect(msUntilNextMinute(new Date(2026, 6, 29, 10, 30, 20, 250))).toBe(39_750);
    expect(msUntilNextMinute(new Date(2026, 6, 29, 10, 30, 59, 999))).toBe(1);
  });

  it("waits a full minute when already on the boundary", () => {
    expect(msUntilNextMinute(new Date(2026, 6, 29, 10, 30, 0, 0))).toBe(60_000);
  });
});
