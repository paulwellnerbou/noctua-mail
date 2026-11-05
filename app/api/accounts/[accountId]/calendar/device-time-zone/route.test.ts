import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account } from "@/lib/data";
import { sealSession, type SessionData } from "@/lib/auth";
import { dbModulePromise } from "@/lib/testDbHarness";

const { getAccountById, upsertAccount } = await dbModulePromise;

const { POST } = await import("./route");

function buildAccount(accountId: string, settings?: Account["settings"]): Account {
  return {
    id: accountId,
    name: "Device Time Zone Test",
    email: "owner@example.test",
    avatar: "",
    settings,
    imap: {
      host: "imap.example.test",
      port: 993,
      secure: true,
      user: "owner@example.test",
      password: "secret"
    },
    smtp: {
      host: "smtp.example.test",
      port: 465,
      secure: true,
      user: "owner@example.test",
      password: "secret"
    }
  };
}

function cookieFor(accountId: string) {
  const session: SessionData = {
    userId: "user-device-time-zone-tests",
    accountId,
    role: "user",
    exp: Math.floor(Date.now() / 1000) + 60 * 60
  };
  return `noctua_session=${encodeURIComponent(sealSession(session))}`;
}

function post(accountId: string, body: unknown, cookie?: string) {
  return POST(
    new Request(`http://localhost/api/accounts/${accountId}/calendar/device-time-zone`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ accountId }) }
  );
}

describe("POST /api/accounts/[accountId]/calendar/device-time-zone", () => {
  test("stores the reported zone next to the other calendar settings", async () => {
    const accountId = `acc-device-tz-${randomUUID()}`;
    await upsertAccount(
      buildAccount(accountId, { calendar: { weekStartsOn: "sunday", timeZone: "America/New_York" } })
    );

    const res = await post(accountId, { timeZone: "Europe/Berlin" }, cookieFor(accountId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Account;
    expect(body.settings?.calendar).toEqual({
      weekStartsOn: "sunday",
      timeZone: "America/New_York",
      deviceTimeZone: "Europe/Berlin"
    });
    expect(body.imap.password).toBe("");

    const stored = await getAccountById(accountId);
    expect(stored?.settings?.calendar?.deviceTimeZone).toBe("Europe/Berlin");
  });

  test("rejects an unknown zone and an unauthenticated request", async () => {
    const accountId = `acc-device-tz-${randomUUID()}`;
    await upsertAccount(buildAccount(accountId));

    const invalid = await post(accountId, { timeZone: "Mars/Olympus" }, cookieFor(accountId));
    expect(invalid.status).toBe(400);
    expect((await getAccountById(accountId))?.settings?.calendar?.deviceTimeZone).toBeUndefined();

    const anonymous = await post(accountId, { timeZone: "Europe/Berlin" });
    expect(anonymous.status).toBe(401);
  });
});
