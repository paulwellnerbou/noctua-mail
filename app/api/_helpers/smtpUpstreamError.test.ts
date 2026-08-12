import { afterEach, describe, expect, it } from "bun:test";
import { markSmtpUpstreamFailure } from "@/lib/mail/smtpError";
import { smtpUpstreamErrorResponse } from "./smtpUpstreamError";

const originalConsoleError = console.error;

afterEach(() => {
  console.error = originalConsoleError;
});

describe("smtpUpstreamErrorResponse", () => {
  it("returns a structured timeout response for the frontend", async () => {
    const logs: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      logs.push(args);
    };

    const response = smtpUpstreamErrorResponse(
      markSmtpUpstreamFailure(Object.assign(new Error("Connection timeout"), {
        code: "ETIMEDOUT",
        command: "CONN"
      })),
      { accountId: "acc-example", op: "send-message" }
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(504);
    expect(await response?.json()).toEqual({
      ok: false,
      message:
        "Timed out while connecting to the outgoing mail server. Check the SMTP server and firewall settings, then try again.",
      code: "smtp_connection_timeout"
    });
    expect(logs).toHaveLength(1);
  });

  it("does not misreport unrelated failures as SMTP outages", () => {
    expect(
      smtpUpstreamErrorResponse(new Error("database is locked"), {
        accountId: "acc-example",
        op: "send-message"
      })
    ).toBeNull();
  });

  it("does not misreport an untagged timeout from another subsystem", () => {
    expect(
      smtpUpstreamErrorResponse(new Error("database timeout"), {
        accountId: "acc-example",
        op: "send-draft"
      })
    ).toBeNull();
  });
});
