import { describe, expect, test } from "bun:test";
import type { Account } from "./data";
import { mergeAccount } from "./db/rowParsers";
import { sanitizeAccountForClient } from "./accountPresentation";

function buildAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-deepl-test",
    name: "DeepL Test",
    email: "owner@example.test",
    avatar: "DT",
    imap: { host: "imap.example.test", port: 993, secure: true, user: "u", password: "imap-secret" },
    smtp: { host: "smtp.example.test", port: 465, secure: true, user: "u", password: "smtp-secret" },
    ...overrides
  };
}

describe("mergeAccount — DeepL key clobber protection", () => {
  const current = buildAccount({
    deepl: { apiKey: "stored-key:fx", enabled: true, targetLang: "DE" }
  });

  test("a blank incoming apiKey preserves the stored key (updates other fields)", () => {
    // Mirrors a settings save: the client only ever holds a blanked key.
    const merged = mergeAccount(current, {
      deepl: { apiKey: "", enabled: false, targetLang: "EN-US" }
    });
    expect(merged.deepl?.apiKey).toBe("stored-key:fx");
    expect(merged.deepl?.enabled).toBe(false);
    expect(merged.deepl?.targetLang).toBe("EN-US");
  });

  test("a non-empty incoming apiKey replaces the stored key", () => {
    const merged = mergeAccount(current, { deepl: { apiKey: "new-key" } });
    expect(merged.deepl?.apiKey).toBe("new-key");
  });

  test("deepl: null clears the stored config", () => {
    const merged = mergeAccount(current, {
      deepl: null as unknown as Account["deepl"]
    });
    expect(merged.deepl).toBeUndefined();
  });

  test("omitting deepl leaves the stored config untouched", () => {
    const merged = mergeAccount(current, { name: "Renamed" });
    expect(merged.deepl?.apiKey).toBe("stored-key:fx");
    expect(merged.deepl?.enabled).toBe(true);
  });

  test("the client-only hasApiKey flag is never persisted through a merge", () => {
    const merged = mergeAccount(current, {
      deepl: { apiKey: "", enabled: true, hasApiKey: true }
    });
    expect(merged.deepl?.hasApiKey).toBeUndefined();
    expect(merged.deepl?.apiKey).toBe("stored-key:fx");
  });
});

describe("sanitizeAccountForClient — DeepL key exposure", () => {
  test("blanks the key and surfaces a presence flag when a key is stored", () => {
    const account = buildAccount({
      deepl: { apiKey: "secret-key:fx", enabled: true, targetLang: "DE" }
    });
    const sanitized = sanitizeAccountForClient(account);
    expect(sanitized.deepl?.apiKey).toBe("");
    expect(sanitized.deepl?.hasApiKey).toBe(true);
    // Non-secret fields still reach the client.
    expect(sanitized.deepl?.enabled).toBe(true);
    expect(sanitized.deepl?.targetLang).toBe("DE");
  });

  test("reports no key when the config has none", () => {
    const account = buildAccount({ deepl: { enabled: false, targetLang: "EN-US" } });
    const sanitized = sanitizeAccountForClient(account);
    expect(sanitized.deepl?.apiKey).toBe("");
    expect(sanitized.deepl?.hasApiKey).toBe(false);
  });

  test("leaves an absent config undefined", () => {
    const sanitized = sanitizeAccountForClient(buildAccount());
    expect(sanitized.deepl).toBeUndefined();
  });
});
