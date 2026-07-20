import { randomUUID } from "crypto";
import { afterEach, describe, expect, test } from "bun:test";
import type { Account, DeeplConfig } from "@/lib/data";
import { sealSession, type SessionData } from "@/lib/auth";
import { dbModulePromise } from "@/lib/testDbHarness";

const { upsertAccount } = await dbModulePromise;

const { POST } = await import("./route");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function buildAccount(accountId: string, deepl?: DeeplConfig): Account {
  return {
    id: accountId,
    name: "Compose Translate Test Account",
    email: "owner@example.test",
    avatar: "",
    deepl,
    imap: {
      host: "imap.example.test",
      port: 993,
      secure: true,
      user: "owner@example.test",
      password: "secret-imap"
    },
    smtp: {
      host: "smtp.example.test",
      port: 465,
      secure: true,
      user: "owner@example.test",
      password: "secret-smtp"
    }
  };
}

function buildCookieHeader(accountId: string) {
  const session: SessionData = {
    userId: "user-compose-translate-tests",
    accountId,
    role: "user",
    exp: Math.floor(Date.now() / 1000) + 60 * 60
  };
  return `noctua_session=${encodeURIComponent(sealSession(session))}`;
}

function buildRequest(
  accountId: string,
  body: unknown,
  options?: { omitCookie?: boolean }
) {
  return new Request(`http://localhost/api/accounts/${accountId}/translation/compose`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options?.omitCookie ? {} : { cookie: buildCookieHeader(accountId) })
    },
    body: JSON.stringify(body)
  });
}

function routeParams(accountId: string) {
  return { params: Promise.resolve({ accountId }) };
}

function uniqueAccountId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function mockDeeplFetch(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>
) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}

function deeplSuccessResponse(text: string, detected = "DE") {
  return new Response(
    JSON.stringify({ translations: [{ detected_source_language: detected, text }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("compose translate route", () => {
  test("translates the supplied draft text and reports the detected language", async () => {
    const accountId = uniqueAccountId("acc-compose-translate");
    await upsertAccount(
      buildAccount(accountId, { enabled: true, apiKey: "test-key:fx", targetLang: "EN-US" })
    );
    const calls = mockDeeplFetch(() => deeplSuccessResponse("Hello colleagues"));

    const response = await POST(
      buildRequest(accountId, { text: "Hallo Kollegen", targetLang: "EN-GB" }),
      routeParams(accountId)
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({
      ok: true,
      format: "text",
      targetLang: "EN-GB",
      translatedText: "Hello colleagues",
      detectedSourceLang: "DE"
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api-free.deepl.com/v2/translate");
    expect(calls[0].body).toMatchObject({ text: ["Hallo Kollegen"], target_lang: "EN-GB" });
    expect(calls[0].body.tag_handling).toBeUndefined();
  });

  test("html format enables tag handling and round-trips inline data URLs", async () => {
    const accountId = uniqueAccountId("acc-compose-translate-html");
    await upsertAccount(
      buildAccount(accountId, { enabled: true, apiKey: "test-key:fx", targetLang: "EN-US" })
    );
    const calls = mockDeeplFetch((url, init) => {
      const body = JSON.parse(String(init?.body)) as { text: string[] };
      // Echo the placeholder back like DeepL would, translating around it.
      return deeplSuccessResponse(body.text[0].replace("Hallo", "Hello"));
    });

    const html = '<p>Hallo</p><img src="data:image/png;base64,AAAABBBB">';
    const response = await POST(
      buildRequest(accountId, { text: html, targetLang: "EN-US", format: "html" }),
      routeParams(accountId)
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.translatedText).toBe('<p>Hello</p><img src="data:image/png;base64,AAAABBBB">');
    expect(calls[0].body.tag_handling).toBe("html");
    // The data URL never reaches DeepL.
    expect(JSON.stringify(calls[0].body)).not.toContain("data:image");
  });

  test("falls back to the account target language when none is supplied", async () => {
    const accountId = uniqueAccountId("acc-compose-translate-default-lang");
    await upsertAccount(
      buildAccount(accountId, { enabled: true, apiKey: "test-key:fx", targetLang: "FR" })
    );
    const calls = mockDeeplFetch(() => deeplSuccessResponse("Bonjour", "DE"));

    const response = await POST(
      buildRequest(accountId, { text: "Hallo" }),
      routeParams(accountId)
    );
    expect(response.status).toBe(200);
    expect((await response.json()).targetLang).toBe("FR");
    expect(calls[0].body.target_lang).toBe("FR");
  });

  test("rejects when translation is not enabled for the account", async () => {
    const accountId = uniqueAccountId("acc-compose-translate-disabled");
    await upsertAccount(buildAccount(accountId, { enabled: false, apiKey: "test-key:fx" }));
    const calls = mockDeeplFetch(() => deeplSuccessResponse("nope"));

    const response = await POST(
      buildRequest(accountId, { text: "Hallo" }),
      routeParams(accountId)
    );
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("not enabled");
    expect(calls).toHaveLength(0);
  });

  test("rejects when no API key is configured", async () => {
    const accountId = uniqueAccountId("acc-compose-translate-no-key");
    await upsertAccount(buildAccount(accountId, { enabled: true, apiKey: "  " }));

    const response = await POST(
      buildRequest(accountId, { text: "Hallo" }),
      routeParams(accountId)
    );
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("No DeepL API key");
  });

  test("rejects empty draft text", async () => {
    const accountId = uniqueAccountId("acc-compose-translate-empty");
    await upsertAccount(
      buildAccount(accountId, { enabled: true, apiKey: "test-key:fx", targetLang: "EN-US" })
    );

    const response = await POST(
      buildRequest(accountId, { text: "   \n " }),
      routeParams(accountId)
    );
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("no content");
  });

  test("requires an authenticated session", async () => {
    const accountId = uniqueAccountId("acc-compose-translate-unauth");
    await upsertAccount(
      buildAccount(accountId, { enabled: true, apiKey: "test-key:fx", targetLang: "EN-US" })
    );

    const response = await POST(
      buildRequest(accountId, { text: "Hallo" }, { omitCookie: true }),
      routeParams(accountId)
    );
    expect(response.status).toBe(401);
  });

  test("maps a DeepL quota failure to its actionable message", async () => {
    const accountId = uniqueAccountId("acc-compose-translate-quota");
    await upsertAccount(
      buildAccount(accountId, { enabled: true, apiKey: "test-key:fx", targetLang: "EN-US" })
    );
    mockDeeplFetch(() => new Response("quota exceeded", { status: 456 }));

    const response = await POST(
      buildRequest(accountId, { text: "Hallo" }),
      routeParams(accountId)
    );
    expect(response.status).toBe(456);
    expect((await response.json()).message).toContain("quota");
  });

  test("maps a bad DeepL key (403) to a 400 so the client shows the message", async () => {
    const accountId = uniqueAccountId("acc-compose-translate-bad-key");
    await upsertAccount(
      buildAccount(accountId, { enabled: true, apiKey: "bad-key", targetLang: "EN-US" })
    );
    mockDeeplFetch(() => new Response("forbidden", { status: 403 }));

    const response = await POST(
      buildRequest(accountId, { text: "Hallo" }),
      routeParams(accountId)
    );
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain("API key");
  });
});
