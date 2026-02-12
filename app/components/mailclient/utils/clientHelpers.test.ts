import { describe, expect, it } from "bun:test";
import { getExceptionSummary } from "./clientHelpers";

describe("getExceptionSummary", () => {
  it("returns the message for single-line errors", () => {
    expect(getExceptionSummary("Failed to load messages.")).toBe("Failed to load messages.");
  });

  it("prefers explicit error lines over code-frame lines", () => {
    const message = [
      "396 |         return;",
      "397 |       }",
      "398 |       err._connId = err._connId || this.id;",
      "    ^",
      "error: Socket timeout",
      "    at emitError (node:events:51:13)"
    ].join("\n");
    expect(getExceptionSummary(message)).toBe("Socket timeout");
  });

  it("uses JavaScript error names when present", () => {
    const message = [
      "123 | const x = y.z();",
      "TypeError: Cannot read properties of undefined (reading 'z')",
      "    at render (/app/components/Foo.tsx:22:10)"
    ].join("\n");
    expect(getExceptionSummary(message)).toBe(
      "TypeError: Cannot read properties of undefined (reading 'z')"
    );
  });

  it("falls back to the first non-noise line", () => {
    const message = [
      "399 |",
      "400 |       this.closeAfter();",
      "    at emitError (node:events:92:22)",
      "Connection not available"
    ].join("\n");
    expect(getExceptionSummary(message)).toBe("Connection not available");
  });
});
