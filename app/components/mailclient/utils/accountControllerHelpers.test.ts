import { describe, expect, it } from "bun:test";
import type { Account } from "@/lib/data";
import {
  buildAccountSaveRequest,
  createBlankEditAccount,
  normalizeCaldavForSave,
  normalizeDeeplForSave,
  resolveActiveAccountId,
  resolveSwitchedAccountId
} from "./accountControllerHelpers";

function makeAccount(id: string, overrides?: Partial<Account>): Account {
  return {
    id,
    name: `Account ${id}`,
    email: `${id}@example.com`,
    avatar: "AA",
    imap: { host: "", port: 993, secure: true, user: "", password: "" },
    smtp: { host: "", port: 587, secure: false, user: "", password: "" },
    ...overrides
  };
}

describe("resolveActiveAccountId", () => {
  it("picks the preferred id when present", () => {
    const list = [makeAccount("a"), makeAccount("b")];
    expect(resolveActiveAccountId(list, "b", "a")).toBe("b");
  });

  it("falls back to the current active id when preferred is absent", () => {
    const list = [makeAccount("a"), makeAccount("b")];
    expect(resolveActiveAccountId(list, "missing", "b")).toBe("b");
  });

  it("falls back to the first account when neither preferred nor active are present", () => {
    const list = [makeAccount("first"), makeAccount("second")];
    expect(resolveActiveAccountId(list, "", "ghost")).toBe("first");
  });

  it("returns the empty string when the list is empty", () => {
    expect(resolveActiveAccountId([], "", "")).toBe("");
  });
});

describe("resolveSwitchedAccountId", () => {
  it("prefers a trimmed accountId from the payload", () => {
    expect(resolveSwitchedAccountId({ accountId: "  x  " }, "fallback")).toBe("x");
  });

  it("falls back to the requested id when payload is missing", () => {
    expect(resolveSwitchedAccountId(null, "requested")).toBe("requested");
  });

  it("falls back when the payload value is blank", () => {
    expect(resolveSwitchedAccountId({ accountId: "   " }, "requested")).toBe("requested");
  });
});

describe("buildAccountSaveRequest", () => {
  it("posts to the collection endpoint without an id for new accounts", () => {
    const request = buildAccountSaveRequest(makeAccount("temp"), false);
    expect(request.method).toBe("POST");
    expect(request.endpoint).toBe("/api/accounts");
    expect(request.isNew).toBe(true);
    expect((request.body as Record<string, unknown>).id).toBeUndefined();
  });

  it("puts to the scoped endpoint with the full account for updates", () => {
    const account = makeAccount("acc-1");
    const request = buildAccountSaveRequest(account, true);
    expect(request.method).toBe("PUT");
    expect(request.endpoint).toContain("acc-1");
    expect(request.isNew).toBe(false);
    expect(request.body).toBe(account);
  });
});

describe("normalizeCaldavForSave", () => {
  it("returns null for missing or blank urls", () => {
    expect(normalizeCaldavForSave(null)).toBeNull();
    expect(normalizeCaldavForSave(undefined)).toBeNull();
    expect(
      normalizeCaldavForSave({ url: "   ", user: "u", password: "p" })
    ).toBeNull();
  });

  it("returns the config when the url is non-empty", () => {
    const config = { url: "https://dav.example/", user: "u", password: "p" };
    expect(normalizeCaldavForSave(config)).toBe(config);
  });
});

describe("normalizeDeeplForSave", () => {
  it("returns null when there is nothing to persist", () => {
    expect(normalizeDeeplForSave(null)).toBeNull();
    expect(normalizeDeeplForSave(undefined)).toBeNull();
    expect(normalizeDeeplForSave({ enabled: false })).toBeNull();
  });

  it("keeps the config when a key is present (typed key)", () => {
    const result = normalizeDeeplForSave({ apiKey: "k:fx", enabled: true, targetLang: "DE" });
    expect(result).toEqual({ apiKey: "k:fx", enabled: true, targetLang: "DE" });
  });

  it("keeps the config for a saved key even when the field is blank", () => {
    // Editing settings without re-typing the key: hasApiKey keeps the config,
    // and the blank apiKey is preserved server-side by mergeAccount.
    const result = normalizeDeeplForSave({
      apiKey: "",
      enabled: false,
      targetLang: "EN-US",
      hasApiKey: true
    });
    expect(result).toEqual({ apiKey: "", enabled: false, targetLang: "EN-US" });
  });

  it("drops the client-only hasApiKey flag from the payload", () => {
    const result = normalizeDeeplForSave({ apiKey: "k", enabled: true, hasApiKey: true });
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("hasApiKey");
  });
});

describe("createBlankEditAccount", () => {
  it("builds a skeleton account with default ports and a truncated id", () => {
    const account = createBlankEditAccount(() => "abcdefghijk");
    expect(account.id).toBe("acc-abcdef");
    expect(account.imap.port).toBe(993);
    expect(account.smtp.port).toBe(587);
    expect(account.imap.secure).toBe(true);
    expect(account.smtp.secure).toBe(false);
    expect(account.email).toBe("");
  });
});
