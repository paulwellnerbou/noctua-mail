import { describe, expect, test } from "bun:test";
import { parseHttpUrl } from "./url";

describe("parseHttpUrl", () => {
  test("returns the normalized URL for http and https", () => {
    expect(parseHttpUrl("https://example.com/foo")).toBe("https://example.com/foo");
    expect(parseHttpUrl("http://example.com")).toBe("http://example.com/");
    expect(parseHttpUrl("  https://example.com  ")).toBe("https://example.com/");
  });

  test("returns null for non-web protocols", () => {
    expect(parseHttpUrl("javascript:alert(1)")).toBeNull();
    expect(parseHttpUrl("data:text/plain,hi")).toBeNull();
    expect(parseHttpUrl("file:///etc/passwd")).toBeNull();
    expect(parseHttpUrl("mailto:foo@example.com")).toBeNull();
  });

  test("returns null for unparseable input", () => {
    expect(parseHttpUrl("not a url")).toBeNull();
    expect(parseHttpUrl("")).toBeNull();
    expect(parseHttpUrl(undefined)).toBeNull();
    expect(parseHttpUrl(null)).toBeNull();
  });
});
