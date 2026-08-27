import { describe, expect, test } from "bun:test";
import { describeMessageSize, formatByteSize } from "./byteSize";

describe("formatByteSize", () => {
  test("sub-KB sizes stay whole bytes", () => {
    expect(formatByteSize(0)).toBe("0 B");
    expect(formatByteSize(812)).toBe("812 B");
    expect(formatByteSize(999)).toBe("999 B");
  });

  test("steps up through decimal units", () => {
    expect(formatByteSize(1_000)).toBe("1.0 KB");
    expect(formatByteSize(47_000)).toBe("47 KB");
    expect(formatByteSize(12_400_000)).toBe("12 MB");
    expect(formatByteSize(2_500_000_000)).toBe("2.5 GB");
  });

  test("keeps one decimal only below 10 units", () => {
    expect(formatByteSize(9_400_000)).toBe("9.4 MB");
    expect(formatByteSize(10_400_000)).toBe("10 MB");
  });

  test("caps at TB rather than inventing a larger unit", () => {
    expect(formatByteSize(5_000_000_000_000_000)).toBe("5000 TB");
  });

  test("returns null for missing or nonsensical input", () => {
    expect(formatByteSize(undefined)).toBeNull();
    expect(formatByteSize(null)).toBeNull();
    expect(formatByteSize(-1)).toBeNull();
    expect(formatByteSize(Number.NaN)).toBeNull();
  });
});

describe("describeMessageSize", () => {
  test("labels a known size", () => {
    expect(describeMessageSize(12_400_000)).toEqual({ label: "12 MB", title: "Size on disk" });
  });

  test("marks a message with no stored source", () => {
    expect(describeMessageSize(undefined)).toEqual({ label: "—", title: "No stored source" });
  });
});
