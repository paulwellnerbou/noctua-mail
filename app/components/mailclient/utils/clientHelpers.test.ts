import { describe, expect, it } from "bun:test";
import {
  getExceptionAccountId,
  getExceptionSummary,
  shouldOfferExceptionRelogin
} from "./clientHelpers";

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

describe("getExceptionAccountId", () => {
  it("extracts the account id from account API paths", () => {
    expect(
      getExceptionAccountId("Request failed (500) /api/accounts/acc-123456/imap/poll")
    ).toBe("acc-123456");
  });

  it("returns null when the message does not include an account path", () => {
    expect(getExceptionAccountId("Network error")).toBeNull();
  });
});

describe("shouldOfferExceptionRelogin", () => {
  it("offers relogin for explicit missing-password errors", () => {
    expect(shouldOfferExceptionRelogin("No password configured")).toBe(true);
  });

  it("offers relogin for account IMAP failures with only generic error text", () => {
    expect(
      shouldOfferExceptionRelogin("Command failed\nRequest failed (500) /api/accounts/acc-123/imap/poll")
    ).toBe(true);
  });

  it("does not offer relogin for unrelated errors", () => {
    expect(shouldOfferExceptionRelogin("Failed to save draft.")).toBe(false);
  });
});
