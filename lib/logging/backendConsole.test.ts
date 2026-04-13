import { describe, expect, it } from "bun:test";

import { formatBackendLogTimestamp, prefixLogLines } from "./backendConsole";

describe("backendConsole", () => {
  it("formats timestamps with milliseconds and timezone offset", () => {
    expect(formatBackendLogTimestamp(new Date())).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2}$/
    );
  });

  it("prefixes each physical log line with the same timestamp", () => {
    const timestamp = "2026-04-13 18:32:45.123 +02:00";

    expect(prefixLogLines("first line\nsecond line", timestamp)).toBe(
      "[2026-04-13 18:32:45.123 +02:00] first line\n[2026-04-13 18:32:45.123 +02:00] second line"
    );
  });
});
