import { describe, expect, it } from "bun:test";
import { getSmtpTimeoutOptions } from "./smtpTimeouts";

describe("getSmtpTimeoutOptions", () => {
  it("uses bounded defaults for every SMTP wait phase", () => {
    expect(getSmtpTimeoutOptions({})).toEqual({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 60_000,
      dnsTimeout: 10_000
    });
  });

  it("accepts positive environment overrides", () => {
    expect(
      getSmtpTimeoutOptions({
        SMTP_CONNECTION_TIMEOUT_MS: "1500.9",
        SMTP_GREETING_TIMEOUT_MS: "2500",
        SMTP_SOCKET_TIMEOUT_MS: "3500",
        SMTP_DNS_TIMEOUT_MS: "4500"
      })
    ).toEqual({
      connectionTimeout: 1500,
      greetingTimeout: 2500,
      socketTimeout: 3500,
      dnsTimeout: 4500
    });
  });

  it("ignores invalid environment overrides", () => {
    expect(
      getSmtpTimeoutOptions({
        SMTP_CONNECTION_TIMEOUT_MS: "0",
        SMTP_GREETING_TIMEOUT_MS: "not-a-number",
        SMTP_SOCKET_TIMEOUT_MS: "-1",
        SMTP_DNS_TIMEOUT_MS: "Infinity"
      })
    ).toEqual({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 60_000,
      dnsTimeout: 10_000
    });
  });
});
