import { randomUUID } from "crypto";
import { describe, expect, test } from "bun:test";
import type { Account } from "@/lib/data";
import { sealSession, type SessionData } from "@/lib/auth";
import { dbModulePromise } from "@/lib/testDbHarness";

const { upsertAccount } = await dbModulePromise;

const { POST } = await import("./route");

function buildAccount(accountId: string): Account {
  return {
    id: accountId,
    name: "Calendar Import Test",
    email: "owner@example.test",
    avatar: "",
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

function buildSession(accountId: string | undefined): SessionData {
  return {
    userId: "user-calendar-import-tests",
    accountId,
    role: "user",
    exp: Math.floor(Date.now() / 1000) + 60 * 60
  };
}

function cookieFor(session: SessionData) {
  return `noctua_session=${encodeURIComponent(sealSession(session))}`;
}

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function makeIcs(uid: string, summary = "Test event") {
  return [
    "BEGIN:VCALENDAR",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SUMMARY:${summary}`,
    "DTSTART:20260615T120000Z",
    "DTEND:20260615T130000Z",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

function postRequest(accountId: string, body: unknown, cookie: string) {
  return new Request("http://localhost/api/calendar/import", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("POST /api/calendar/import", () => {
  test("returns 401 when no session cookie is present", async () => {
    const res = await POST(
      new Request("http://localhost/api/calendar/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ icsSource: "ignored" })
      })
    );
    expect(res.status).toBe(401);
  });

  test("returns 400 when the body is not a JSON object", async () => {
    const accountId = uniqueAccountId("acc-import-bad-body");
    await upsertAccount(buildAccount(accountId));
    const res = await POST(postRequest(accountId, "\"a string\"", cookieFor(buildSession(accountId))));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok?: boolean; message?: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/Invalid body/i);
  });

  test("returns 400 when icsSource is missing or not a string", async () => {
    const accountId = uniqueAccountId("acc-import-bad-ics");
    await upsertAccount(buildAccount(accountId));
    const cookie = cookieFor(buildSession(accountId));

    const missing = await POST(postRequest(accountId, {}, cookie));
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { message?: string }).message).toMatch(/Missing icsSource/i);

    const wrongType = await POST(postRequest(accountId, { icsSource: 42 }, cookie));
    expect(wrongType.status).toBe(400);
    expect(((await wrongType.json()) as { message?: string }).message).toMatch(/Missing icsSource/i);

    const blank = await POST(postRequest(accountId, { icsSource: "   " }, cookie));
    expect(blank.status).toBe(400);
  });

  test("returns 400 when accountId is provided but not a string", async () => {
    const accountId = uniqueAccountId("acc-import-bad-acc");
    await upsertAccount(buildAccount(accountId));
    const res = await POST(
      postRequest(
        accountId,
        { icsSource: makeIcs("any-uid"), accountId: 123 },
        cookieFor(buildSession(accountId))
      )
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message?: string }).message).toMatch(/Invalid accountId/i);
  });

  test("returns 400 when the session has no accountId bound", async () => {
    const res = await POST(
      postRequest(
        "ignored",
        { icsSource: makeIcs("u1") },
        cookieFor(buildSession(undefined))
      )
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message?: string }).message).toMatch(/Sign in to an account/i);
  });

  test("returns 403 when body.accountId does not match the session's account", async () => {
    const sessionAccountId = uniqueAccountId("acc-import-session");
    const otherAccountId = uniqueAccountId("acc-import-other");
    await upsertAccount(buildAccount(sessionAccountId));
    await upsertAccount(buildAccount(otherAccountId));

    const res = await POST(
      postRequest(
        sessionAccountId,
        { icsSource: makeIcs("u1"), accountId: otherAccountId },
        cookieFor(buildSession(sessionAccountId))
      )
    );
    expect(res.status).toBe(403);
  });

  test("imports a valid ICS for the session's account", async () => {
    const accountId = uniqueAccountId("acc-import-happy");
    await upsertAccount(buildAccount(accountId));
    const uid = `happy-${randomUUID()}@example.test`;
    const res = await POST(
      postRequest(
        accountId,
        { icsSource: makeIcs(uid, "Happy path event") },
        cookieFor(buildSession(accountId))
      )
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok?: boolean;
      accountId?: string;
      eventUids?: string[];
      imports?: Array<{ eventUid: string; summary?: string; action: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.accountId).toBe(accountId);
    expect(body.eventUids).toContain(uid);
    expect(body.imports?.[0]?.summary).toBe("Happy path event");
    expect(body.imports?.[0]?.action).toBe("upsert");
  });

  test("returns 400 with the parser error when the ICS contains no calendar data", async () => {
    const accountId = uniqueAccountId("acc-import-empty-ics");
    await upsertAccount(buildAccount(accountId));
    const res = await POST(
      postRequest(
        accountId,
        { icsSource: "BEGIN:VCALENDAR\r\nEND:VCALENDAR" },
        cookieFor(buildSession(accountId))
      )
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message?: string }).message).toMatch(/No calendar event data/i);
  });
});
