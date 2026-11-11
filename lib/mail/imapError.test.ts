import { describe, expect, it } from "bun:test";
import {
  describeImapError,
  getImapHttpError,
  isImapConnectFailure,
  isTemporaryImapAuthFailure,
  markImapConnectFailure
} from "./imapError";

// imapflow marks every failed LOGIN/AUTHENTICATE like this, whatever the cause.
const unavailableLogin = {
  message: "Command failed",
  response: "2 NO [UNAVAILABLE] Temporary authentication failure.",
  responseStatus: "NO",
  executedCommand: "2 AUTHENTICATE PLAIN",
  responseText: "Temporary authentication failure.",
  serverResponseCode: "UNAVAILABLE",
  authenticationFailed: true
};
const rejectedLoginWithoutCode = {
  message: "Command failed",
  response: "2 NO Login failed.",
  responseStatus: "NO",
  executedCommand: "2 LOGIN",
  responseText: "Login failed.",
  authenticationFailed: true
};

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

  it("does not ask for new credentials when the server could not process the login", () => {
    expect(getImapHttpError(unavailableLogin)).toBeNull();
  });

  it("maps a login the server rejected without a response code to 401", () => {
    expect(getImapHttpError(rejectedLoginWithoutCode)?.code).toBe("imap_auth_failed");
  });
});

describe("isTemporaryImapAuthFailure", () => {
  it("recognizes a login the server could not process", () => {
    expect(isTemporaryImapAuthFailure(unavailableLogin)).toBe(true);
  });

  it("does not cover rejected or unconfigured credentials", () => {
    expect(
      isTemporaryImapAuthFailure({
        ...unavailableLogin,
        response: "2 NO [AUTHENTICATIONFAILED] Authentication failed.",
        serverResponseCode: "AUTHENTICATIONFAILED"
      })
    ).toBe(false);
    expect(isTemporaryImapAuthFailure(rejectedLoginWithoutCode)).toBe(false);
    expect(
      isTemporaryImapAuthFailure(
        Object.assign(new Error("No password configured"), { authenticationFailed: true })
      )
    ).toBe(false);
  });

  it("ignores the same response code outside the login", () => {
    expect(
      isTemporaryImapAuthFailure({ ...unavailableLogin, authenticationFailed: undefined })
    ).toBe(false);
  });
});

describe("describeImapError", () => {
  it("adds the server's reply to imapflow's generic message", () => {
    expect(describeImapError(unavailableLogin)).toBe(
      "Command failed ([UNAVAILABLE] Temporary authentication failure.)"
    );
  });

  it("keeps the message of errors without a server reply", () => {
    expect(describeImapError(new Error("Socket timeout"))).toBe("Socket timeout");
    expect(describeImapError("boom")).toBe("boom");
  });
});

describe("markImapConnectFailure / isImapConnectFailure", () => {
  it("recognizes tagged errors and returns the same instance", () => {
    const error = new Error("connect ETIMEDOUT");
    expect(markImapConnectFailure(error)).toBe(error);
    expect(isImapConnectFailure(error)).toBe(true);
  });

  it("does not flag untagged or non-object errors", () => {
    expect(isImapConnectFailure(new Error("db is locked"))).toBe(false);
    expect(isImapConnectFailure(null)).toBe(false);
    expect(isImapConnectFailure("boom")).toBe(false);
  });

  it("leaves non-extensible errors unmarked instead of throwing", () => {
    const error = Object.freeze(new Error("frozen"));
    expect(markImapConnectFailure(error)).toBe(error);
    expect(isImapConnectFailure(error)).toBe(false);
  });

  it("keeps the flag out of enumerable/serialized properties", () => {
    const error = markImapConnectFailure(new Error("connect ETIMEDOUT"));
    expect(Object.keys(error)).toEqual([]);
    expect(JSON.stringify(error)).toBe("{}");
  });
});
