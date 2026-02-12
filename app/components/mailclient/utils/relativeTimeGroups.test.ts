import { describe, expect, it } from "bun:test";
import { groupItemsByRelativeTime } from "./relativeTimeGroups";

function localDateMs(year: number, monthIndex: number, day: number) {
  return new Date(year, monthIndex, day).getTime();
}

function getGroupLabel(timestampMs: number, nowMs: number) {
  const grouped = groupItemsByRelativeTime([timestampMs], (value) => value, nowMs);
  return grouped[0]?.label;
}

describe("groupItemsByRelativeTime", () => {
  it("ends This Week on Sunday and starts Next Week on Monday", () => {
    const nowMs = localDateMs(2024, 0, 4); // Thu Jan 4, 2024
    expect(getGroupLabel(localDateMs(2024, 0, 7), nowMs)).toBe("This Week"); // Sun
    expect(getGroupLabel(localDateMs(2024, 0, 8), nowMs)).toBe("Next Week"); // Mon
  });

  it("keeps Next Week aligned to the next Monday-Sunday window", () => {
    const nowMs = localDateMs(2024, 0, 3); // Wed Jan 3, 2024
    expect(getGroupLabel(localDateMs(2024, 0, 8), nowMs)).toBe("Next Week"); // Mon
    expect(getGroupLabel(localDateMs(2024, 0, 14), nowMs)).toBe("Next Week"); // Sun
    expect(getGroupLabel(localDateMs(2024, 0, 15), nowMs)).toBe("In 2 weeks"); // Mon
  });

  it("keeps Tomorrow as a separate bucket even across week boundaries", () => {
    const nowMs = localDateMs(2024, 0, 7); // Sun Jan 7, 2024
    expect(getGroupLabel(localDateMs(2024, 0, 8), nowMs)).toBe("Tomorrow"); // Mon
    expect(getGroupLabel(localDateMs(2024, 0, 9), nowMs)).toBe("Next Week"); // Tue
  });
});
