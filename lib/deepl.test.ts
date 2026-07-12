import { describe, expect, test } from "bun:test";
import {
  deeplBaseForKey,
  deeplEndpointForKey,
  extractInlineData,
  isDeeplFreeKey,
  restoreInlineData
} from "./deepl";

describe("DeepL endpoint selection", () => {
  test('free-tier keys (":fx" suffix) resolve to the free host', () => {
    expect(isDeeplFreeKey("0123abcd-4567-89ef:fx")).toBe(true);
    expect(deeplBaseForKey("0123abcd-4567-89ef:fx")).toBe("https://api-free.deepl.com");
    expect(deeplEndpointForKey("0123abcd-4567-89ef:fx")).toBe(
      "https://api-free.deepl.com/v2/translate"
    );
  });

  test("pro keys resolve to the pro host", () => {
    expect(isDeeplFreeKey("0123abcd-4567-89ef")).toBe(false);
    expect(deeplBaseForKey("0123abcd-4567-89ef")).toBe("https://api.deepl.com");
    expect(deeplEndpointForKey("0123abcd-4567-89ef")).toBe(
      "https://api.deepl.com/v2/translate"
    );
  });

  test("surrounding whitespace does not hide the free suffix", () => {
    expect(isDeeplFreeKey("  key-value:fx  ")).toBe(true);
  });
});

describe("inline data-URI extraction", () => {
  test("strips an inline base64 image and restores it round-trip", () => {
    const html = '<p>你好</p><img src="data:image/png;base64,AAAABBBBCCCC"><p>bye</p>';
    const { text, tokens, marker } = extractInlineData(html);
    expect(tokens).toEqual(["data:image/png;base64,AAAABBBBCCCC"]);
    // The data URI is replaced by a marker-scoped placeholder.
    expect(text).not.toContain("data:image");
    expect(text).toContain(`__NOCTUA_INLINE_DATA_${marker}_0__`);
    // A translation preserves the placeholder; restoring yields the image back.
    const translated = text.replace("你好", "Hello");
    expect(restoreInlineData(translated, tokens, marker)).toBe(
      '<p>Hello</p><img src="data:image/png;base64,AAAABBBBCCCC"><p>bye</p>'
    );
  });

  test("collapses a huge data URI to a tiny payload (the reported bug)", () => {
    const huge = "data:image/png;base64," + "A".repeat(400_000);
    const body = `Scan the code: <img src="${huge}"> to sign up.`;
    const { text, tokens } = extractInlineData(body);
    expect(tokens).toHaveLength(1);
    expect(text.length).toBeLessThan(200);
    expect(Buffer.byteLength(text)).toBeLessThan(131_072);
  });

  test("handles multiple data URIs by index", () => {
    const src = "a data:image/gif;base64,ONE b data:image/gif;base64,TWO c";
    const { text, tokens, marker } = extractInlineData(src);
    expect(tokens).toEqual(["data:image/gif;base64,ONE", "data:image/gif;base64,TWO"]);
    expect(restoreInlineData(text, tokens, marker)).toBe(src);
  });

  test("uses a random per-call marker so placeholders can't collide", () => {
    const a = extractInlineData('<img src="data:image/png;base64,AAA">');
    const b = extractInlineData('<img src="data:image/png;base64,BBB">');
    expect(a.marker).not.toBe(b.marker);
    // Restoring with call A's marker must not rewrite a placeholder-shaped
    // string carrying a different marker — so stray text is never mutated.
    const foreign = `text __NOCTUA_INLINE_DATA_${b.marker}_0__ text`;
    expect(restoreInlineData(foreign, a.tokens, a.marker)).toBe(foreign);
  });

  test("leaves text without data URIs untouched", () => {
    const { text, tokens, marker } = extractInlineData("plain body, no images");
    expect(tokens).toEqual([]);
    expect(restoreInlineData(text, tokens, marker)).toBe("plain body, no images");
  });

  test("a placeholder DeepL failed to echo back is left as-is, not crashed", () => {
    // Defensive: if a token goes missing, restore leaves the placeholder rather
    // than inserting `undefined`.
    const marker = "abc123";
    expect(
      restoreInlineData(`x __NOCTUA_INLINE_DATA_${marker}_5__ y`, ["only-one"], marker)
    ).toBe(`x __NOCTUA_INLINE_DATA_${marker}_5__ y`);
  });
});
