import { describe, expect, test } from "bun:test";
import { createFetchStub } from "@/lib/testFetchStub";
import {
  backgroundPollIntervalMs,
  checkBackgroundAccountMail,
  createBackgroundMailChecker,
  type BackgroundMailAccount
} from "./backgroundMailCheck";
import {
  BACKGROUND_MAIL_SIGN_IN_RETRY_MS,
  INBOX_POLL_DEFAULT_INTERVAL_MS,
  INBOX_POLL_UNATTENDED_MIN_INTERVAL_MS
} from "./constants";

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

  test("does not take a missing UIDNEXT as the mailbox position", async () => {
    const { apiFetch } = stubPoll({ ok: true, uidNext: 0, messages: [] });
    expect(await checkBackgroundAccountMail("acc-other", undefined, apiFetch)).toBeNull();
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

/** Answers each poll with the next queued reply and records what was asked. */
function scriptedPoll(replies: Array<{ status?: number; body: unknown }>) {
  const requested: string[] = [];
  const apiFetch = createFetchStub(async (input) => {
    requested.push(String(input).replace("/api/accounts/", ""));
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected poll");
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json" }
    });
  });
  return { apiFetch, requested };
}

const work: BackgroundMailAccount = { id: "acc-work", email: "work@example.com", label: "Work" };
const INTERVAL = INBOX_POLL_DEFAULT_INTERVAL_MS;
const mail = { uid: 42, subject: "Hello", messageId: "<a@example.com>" };

describe("backgroundPollIntervalMs", () => {
  test("uses the account setting, but not below the floor for unattended polls", () => {
    expect(backgroundPollIntervalMs(work)).toBe(INBOX_POLL_DEFAULT_INTERVAL_MS);
    expect(backgroundPollIntervalMs({ ...work, pollIntervalMs: 600_000 })).toBe(600_000);
    expect(backgroundPollIntervalMs({ ...work, pollIntervalMs: 10_000 })).toBe(
      INBOX_POLL_UNATTENDED_MIN_INTERVAL_MS
    );
  });
});

describe("createBackgroundMailChecker", () => {
  test("records the position first and announces mail that arrives after it", async () => {
    const { apiFetch, requested } = scriptedPoll([
      { body: { ok: true, uidNext: 42, messages: [] } },
      { body: { ok: true, uidNext: 43, messages: [mail] } }
    ]);
    const checker = createBackgroundMailChecker();
    checker.watch([work.id]);

    expect(await checker.check(work, apiFetch, 0)).toBeNull();
    expect(await checker.check(work, apiFetch, INTERVAL)).toEqual({
      items: [mail],
      acknowledgedUid: 41
    });
    expect(requested).toEqual([
      "acc-work/imap/poll?statusOnly=1",
      "acc-work/imap/poll?sinceUidNext=42"
    ]);
  });

  test("does not ask the server again before the account is due", async () => {
    const { apiFetch, requested } = scriptedPoll([
      { body: { ok: true, uidNext: 42, messages: [] } }
    ]);
    const checker = createBackgroundMailChecker();
    checker.watch([work.id]);

    await checker.check(work, apiFetch, 0);
    expect(await checker.check(work, apiFetch, INTERVAL - 1)).toBeNull();
    expect(requested).toHaveLength(1);
  });

  test("keeps the other accounts' schedule when the watched set changes", async () => {
    const { apiFetch, requested } = scriptedPoll([
      { body: { ok: true, uidNext: 42, messages: [] } }
    ]);
    const checker = createBackgroundMailChecker();
    checker.watch([work.id, "acc-home"]);
    await checker.check(work, apiFetch, 0);

    checker.watch([work.id, "acc-family"]);
    expect(await checker.check(work, apiFetch, 1000)).toBeNull();
    expect(requested).toHaveLength(1);
  });

  test("starts over for an account that was on screen in the meantime", async () => {
    const { apiFetch, requested } = scriptedPoll([
      { body: { ok: true, uidNext: 42, messages: [] } },
      { body: { ok: true, uidNext: 50, messages: [] } },
      { body: { ok: true, uidNext: 50, messages: [] } }
    ]);
    const checker = createBackgroundMailChecker();
    checker.watch([work.id]);
    await checker.check(work, apiFetch, 0);

    checker.watch([]);
    expect(await checker.check(work, apiFetch, INTERVAL)).toBeNull();
    checker.watch([work.id]);

    // Due at once, and only asked where the mailbox stands: the mail that
    // arrived while the account was on screen is not announced.
    expect(await checker.check(work, apiFetch, 1000)).toBeNull();
    expect(await checker.check(work, apiFetch, 1000 + INTERVAL)).toBeNull();
    expect(requested).toEqual([
      "acc-work/imap/poll?statusOnly=1",
      "acc-work/imap/poll?statusOnly=1",
      "acc-work/imap/poll?sinceUidNext=50"
    ]);
  });

  test("drops a reply that arrives after the account moved on screen", async () => {
    const checker = createBackgroundMailChecker();
    checker.watch([work.id]);
    const first = scriptedPoll([{ body: { ok: true, uidNext: 42, messages: [] } }]);
    await checker.check(work, first.apiFetch, 0);

    const apiFetch = createFetchStub(async () => {
      checker.watch([]);
      return new Response(JSON.stringify({ ok: true, uidNext: 43, messages: [mail] }));
    });
    expect(await checker.check(work, apiFetch, INTERVAL)).toBeNull();
  });

  test("waits much longer after rejected credentials", async () => {
    const { apiFetch, requested } = scriptedPoll([
      { status: 401, body: { ok: false, reauthRequired: true } },
      { body: { ok: true, uidNext: 42, messages: [] } }
    ]);
    const checker = createBackgroundMailChecker();
    checker.watch([work.id]);

    expect(await checker.check(work, apiFetch, 0)).toBeNull();
    expect(await checker.check(work, apiFetch, BACKGROUND_MAIL_SIGN_IN_RETRY_MS - 1)).toBeNull();
    expect(requested).toHaveLength(1);
    expect(await checker.check(work, apiFetch, BACKGROUND_MAIL_SIGN_IN_RETRY_MS)).toBeNull();
    expect(requested).toHaveLength(2);
  });

  test("retries a failed check after the regular interval and keeps the position", async () => {
    const { apiFetch, requested } = scriptedPoll([
      { body: { ok: true, uidNext: 42, messages: [] } },
      { status: 503, body: { ok: false } },
      { body: { ok: true, uidNext: 43, messages: [mail] } }
    ]);
    const checker = createBackgroundMailChecker();
    checker.watch([work.id]);
    await checker.check(work, apiFetch, 0);

    await expect(checker.check(work, apiFetch, INTERVAL)).rejects.toThrow("503");
    expect(await checker.check(work, apiFetch, INTERVAL + 1000)).toBeNull();
    expect(await checker.check(work, apiFetch, 2 * INTERVAL)).toEqual({
      items: [mail],
      acknowledgedUid: 41
    });
    expect(requested).toHaveLength(3);
  });

  test("ignores accounts it was not told to watch", async () => {
    const { apiFetch, requested } = scriptedPoll([]);
    const checker = createBackgroundMailChecker();
    expect(await checker.check(work, apiFetch, 0)).toBeNull();
    expect(requested).toHaveLength(0);
  });
});
