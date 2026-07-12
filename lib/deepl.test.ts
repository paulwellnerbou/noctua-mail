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
    const { text, tokens } = extractInlineData(html);
    expect(tokens).toEqual(["data:image/png;base64,AAAABBBBCCCC"]);
    expect(text).toBe('<p>你好</p><img src="__NOCTUA_INLINE_DATA_0__"><p>bye</p>');
    // A translation preserves the placeholder; restoring yields the image back.
    const translated = text.replace("你好", "Hello");
    expect(restoreInlineData(translated, tokens)).toBe(
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
    const { text, tokens } = extractInlineData(src);
    expect(tokens).toEqual(["data:image/gif;base64,ONE", "data:image/gif;base64,TWO"]);
    expect(restoreInlineData(text, tokens)).toBe(src);
  });

  test("leaves text without data URIs untouched", () => {
    const { text, tokens } = extractInlineData("plain body, no images");
    expect(tokens).toEqual([]);
    expect(restoreInlineData(text, tokens)).toBe("plain body, no images");
  });

  test("a placeholder DeepL failed to echo back is left as-is, not crashed", () => {
    // Defensive: if a token goes missing, restore leaves the placeholder rather
    // than inserting `undefined`.
    expect(restoreInlineData("x __NOCTUA_INLINE_DATA_5__ y", [])).toBe(
      "x __NOCTUA_INLINE_DATA_5__ y"
    );
  });
});
