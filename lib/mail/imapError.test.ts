import { describe, expect, it } from "bun:test";
import { getImapHttpError } from "./imapError";

describe("getImapHttpError", () => {
  it("maps IMAP authentication failures to 401", () => {
    expect(
      getImapHttpError({
        response: "2 NO [AUTHENTICATIONFAILED] Authentication failed.",
        responseStatus: "NO",
        executedCommand: "2 AUTHENTICATE PLAIN",
        responseText: "Authentication failed.",
        serverResponseCode: "AUTHENTICATIONFAILED",
        authenticationFailed: true
      })
    ).toEqual({
      status: 401,
      message: "Invalid IMAP credentials",
      code: "imap_auth_failed",
      reauthRequired: true
    });
  });

  it("maps missing-password errors to 401", () => {
    expect(getImapHttpError(new Error("No password configured"))).toEqual({
      status: 401,
      message: "No password configured",
      code: "imap_password_missing",
      reauthRequired: true
    });
  });

  it("leaves unrelated IMAP errors unmapped", () => {
    expect(getImapHttpError(new Error("Socket timeout"))).toBeNull();
  });
});
