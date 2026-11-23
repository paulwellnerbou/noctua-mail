import { describe, expect, test } from "bun:test";
import { createFetchStub } from "@/lib/testFetchStub";
import { checkBackgroundAccountMail } from "./backgroundMailCheck";

function stubPoll(body: unknown, status = 200) {
  const requested: string[] = [];
  const apiFetch = createFetchStub(async (input) => {
    requested.push(String(input));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  });
  return { apiFetch, requested };
}

describe("checkBackgroundAccountMail", () => {
  test("first check only asks where the mailbox stands", async () => {
    const { apiFetch, requested } = stubPoll({ ok: true, uidNext: 42, messages: [] });
    const result = await checkBackgroundAccountMail("acc-other", undefined, apiFetch);
    expect(requested).toEqual(["/api/accounts/acc-other/imap/poll?statusOnly=1"]);
    expect(result).toEqual({ status: "ok", uidNext: 42, found: null });
  });

  test("never announces mail on the first check, even if the server sends some", async () => {
    const { apiFetch } = stubPoll({
      ok: true,
      uidNext: 42,
      messages: [{ uid: 41, subject: "Old" }]
    });
    const result = await checkBackgroundAccountMail("acc-other", undefined, apiFetch);
    expect(result).toEqual({ status: "ok", uidNext: 42, found: null });
  });

  test("later checks ask for mail since the known position", async () => {
    const messages = [
      { uid: 42, subject: "Hello", from: "Alice <alice@example.com>", messageId: "<a@example.com>" }
    ];
    const { apiFetch, requested } = stubPoll({ ok: true, uidNext: 43, messages });
    const result = await checkBackgroundAccountMail("acc-other", 42, apiFetch);
    expect(requested).toEqual(["/api/accounts/acc-other/imap/poll?sinceUidNext=42"]);
    expect(result).toEqual({
      status: "ok",
      uidNext: 43,
      found: { items: messages, acknowledgedUid: 41 }
    });
  });

  test("reports the position without mail when nothing arrived", async () => {
    const { apiFetch } = stubPoll({ ok: true, uidNext: 42, messages: [] });
    const result = await checkBackgroundAccountMail("acc-other", 42, apiFetch);
    expect(result).toEqual({ status: "ok", uidNext: 42, found: null });
  });

  test("keeps the known position when the response carries none", async () => {
    const { apiFetch } = stubPoll({ ok: false, message: "nope" });
    expect(await checkBackgroundAccountMail("acc-other", 42, apiFetch)).toBeNull();
  });

  test("reports rejected credentials instead of throwing", async () => {
    const { apiFetch } = stubPoll({ ok: false, reauthRequired: true }, 401);
    expect(await checkBackgroundAccountMail("acc-other", 42, apiFetch)).toEqual({
      status: "needs-sign-in"
    });
  });

  test("throws on any other error status so the caller can log it", async () => {
    const { apiFetch } = stubPoll({ ok: false }, 503);
    await expect(checkBackgroundAccountMail("acc-other", 42, apiFetch)).rejects.toThrow("503");
  });
});
