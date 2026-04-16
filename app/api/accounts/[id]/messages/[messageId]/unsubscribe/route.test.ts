import { describe, expect, mock, test } from "bun:test";
import type { LookupFn } from "@/lib/net/urlSafety";
import { parseListUnsubscribeUrls, performOneClickUnsubscribe } from "./route";

// These tests cover the SSRF guard around the RFC 8058 one-click POST.
// `assertPublicUrl` itself is covered exhaustively in lib/net/urlSafety.test.ts;
// here we verify the guard is actually *in the path* to `fetch()` and that
// the rejection shape is wired through correctly.

describe("performOneClickUnsubscribe — URL safety guard", () => {
  const denyLookup: LookupFn = async () => {
    throw new Error("DNS should not be called");
  };

  test("rejects non-https URLs before issuing any request", async () => {
    const fetchImpl = mock(() => Promise.resolve(new Response(null, { status: 200 })));
    const res = await performOneClickUnsubscribe("http://example.com/unsub", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: denyLookup
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
      expect(res.message).toContain("unsupported-protocol");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("rejects literal loopback IPv4 before issuing any request", async () => {
    const fetchImpl = mock(() => Promise.resolve(new Response(null, { status: 200 })));
    const res = await performOneClickUnsubscribe("https://127.0.0.1/unsub", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: denyLookup
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
      expect(res.message).toContain("private-ip");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("rejects cloud metadata literal 169.254.169.254 before issuing any request", async () => {
    const fetchImpl = mock(() => Promise.resolve(new Response(null, { status: 200 })));
    const res = await performOneClickUnsubscribe(
      "https://169.254.169.254/latest/meta-data/",
      { fetchImpl: fetchImpl as unknown as typeof fetch, lookup: denyLookup }
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("private-ip");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("rejects IPv6 loopback in bracket form before issuing any request", async () => {
    const fetchImpl = mock(() => Promise.resolve(new Response(null, { status: 200 })));
    const res = await performOneClickUnsubscribe("https://[::1]/unsub", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: denyLookup
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("private-ip");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("rejects hostnames that resolve to a private address", async () => {
    const fetchImpl = mock(() => Promise.resolve(new Response(null, { status: 200 })));
    const lookup: LookupFn = async () => [{ address: "10.0.0.5", family: 4 }];
    const res = await performOneClickUnsubscribe("https://internal.example.test/unsub", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("private-ip");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("rejects malformed URLs", async () => {
    const fetchImpl = mock(() => Promise.resolve(new Response(null, { status: 200 })));
    const res = await performOneClickUnsubscribe("not a url", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: denyLookup
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("invalid-url");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("performOneClickUnsubscribe — request behaviour", () => {
  const publicLookup: LookupFn = async () => [
    { address: "93.184.216.34", family: 4 }
  ];

  test("issues POST to the validated URL with RFC 8058 body when the host is public", async () => {
    const fetchImpl = mock(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://public.example.test/unsub");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe("List-Unsubscribe=One-Click");
      const headers = new Headers(init?.headers);
      expect(headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
      return new Response(null, { status: 200 });
    });

    const res = await performOneClickUnsubscribe("https://public.example.test/unsub", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: publicLookup
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("accepts 202 Accepted as success", async () => {
    const fetchImpl = mock(() => Promise.resolve(new Response(null, { status: 202 })));
    const res = await performOneClickUnsubscribe("https://public.example.test/unsub", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: publicLookup
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.status).toBe(202);
  });

  test("reports 502 with upstream status when the remote returns 4xx/5xx", async () => {
    const fetchImpl = mock(() => Promise.resolve(new Response(null, { status: 403 })));
    const res = await performOneClickUnsubscribe("https://public.example.test/unsub", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: publicLookup
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(502);
      expect(res.message).toContain("403");
    }
  });

  test("reports 502 when fetch throws", async () => {
    const fetchImpl = mock(() => Promise.reject(new Error("connect ECONNREFUSED")));
    const res = await performOneClickUnsubscribe("https://public.example.test/unsub", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      lookup: publicLookup
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(502);
      expect(res.message).toContain("ECONNREFUSED");
    }
  });
});

describe("parseListUnsubscribeUrls — http/https separation", () => {
  test("splits http and https into separate buckets", () => {
    const result = parseListUnsubscribeUrls(
      "<http://insecure.example.test/unsub>, <https://secure.example.test/unsub>"
    );
    expect(result.https).toEqual(["https://secure.example.test/unsub"]);
    expect(result.http).toEqual(["http://insecure.example.test/unsub"]);
    expect(result.mailto).toEqual([]);
  });

  test("collects mailto separately from web URLs", () => {
    const result = parseListUnsubscribeUrls(
      "<mailto:unsub@example.test>, <https://example.test/unsub>"
    );
    expect(result.https).toEqual(["https://example.test/unsub"]);
    expect(result.http).toEqual([]);
    expect(result.mailto).toEqual(["mailto:unsub@example.test"]);
  });

  test("regression: does NOT lump http into the https bucket — one-click would otherwise pick the insecure URL and fail validation even when a valid https URL is present", () => {
    // This is the scenario called out in the PR review: a header like
    // `<http://...>, <https://...>` used to put both into `urls.https`,
    // so the one-click path would pick the http entry (position 0), get
    // rejected by assertPublicUrl as `unsupported-protocol`, and never
    // try the https entry.
    const result = parseListUnsubscribeUrls(
      "<http://first.example.test/u>, <https://second.example.test/u>"
    );
    expect(result.https[0]).toBe("https://second.example.test/u");
    expect(result.http[0]).toBe("http://first.example.test/u");
  });

  test("ignores unknown schemes", () => {
    const result = parseListUnsubscribeUrls("<javascript:alert(1)>, <ftp://example.test/u>");
    expect(result.https).toEqual([]);
    expect(result.http).toEqual([]);
    expect(result.mailto).toEqual([]);
  });

  test("returns empty buckets for a header with no angle-bracketed URLs", () => {
    const result = parseListUnsubscribeUrls("junk without brackets");
    expect(result).toEqual({ https: [], http: [], mailto: [] });
  });
});
