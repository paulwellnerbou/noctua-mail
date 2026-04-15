import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  createRateLimiter,
  createRequestIpResolver,
  getRequestIp,
  parseTrustedProxyHops
} from "./rateLimit";

describe("createRateLimiter", () => {
  beforeEach(() => {
    mock.module("./rateLimit", () => require("./rateLimit"));
  });

  afterEach(() => {
    // Restore Date.now in case a test stubbed it.
    if ((Date.now as unknown as { mock?: unknown }).mock) {
      (Date.now as unknown as { mockRestore?: () => void }).mockRestore?.();
    }
  });

  it("allows up to `max` requests per window then blocks further calls", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    expect(limiter.isLimited("1.1.1.1")).toBe(false);
    expect(limiter.isLimited("1.1.1.1")).toBe(false);
    expect(limiter.isLimited("1.1.1.1")).toBe(false);
    expect(limiter.isLimited("1.1.1.1")).toBe(true);
    expect(limiter.isLimited("1.1.1.1")).toBe(true);
  });

  it("tracks budgets per IP independently", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    expect(limiter.isLimited("1.1.1.1")).toBe(false);
    expect(limiter.isLimited("2.2.2.2")).toBe(false);
    expect(limiter.isLimited("1.1.1.1")).toBe(true);
    expect(limiter.isLimited("2.2.2.2")).toBe(true);
    expect(limiter.isLimited("3.3.3.3")).toBe(false);
  });

  it("resets the budget after the window elapses", () => {
    const realNow = Date.now;
    let now = 1_000_000;
    spyOnDateNow(() => now);
    try {
      const limiter = createRateLimiter({ windowMs: 1_000, max: 2 });
      expect(limiter.isLimited("1.1.1.1")).toBe(false);
      expect(limiter.isLimited("1.1.1.1")).toBe(false);
      expect(limiter.isLimited("1.1.1.1")).toBe(true);
      now += 1_001;
      expect(limiter.isLimited("1.1.1.1")).toBe(false);
      expect(limiter.isLimited("1.1.1.1")).toBe(false);
      expect(limiter.isLimited("1.1.1.1")).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it("uses default budget of 10 per minute when no options are given", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 10; i += 1) {
      expect(limiter.isLimited("1.1.1.1")).toBe(false);
    }
    expect(limiter.isLimited("1.1.1.1")).toBe(true);
  });
});

describe("parseTrustedProxyHops", () => {
  it("defaults to 1 when unset (assumes one reverse proxy in front)", () => {
    expect(parseTrustedProxyHops(undefined)).toBe(1);
    expect(parseTrustedProxyHops(null)).toBe(1);
    expect(parseTrustedProxyHops("")).toBe(1);
    expect(parseTrustedProxyHops("  ")).toBe(1);
  });

  it("returns 0 for explicit off values", () => {
    expect(parseTrustedProxyHops("false")).toBe(0);
    expect(parseTrustedProxyHops("FALSE")).toBe(0);
    expect(parseTrustedProxyHops("no")).toBe(0);
    expect(parseTrustedProxyHops("0")).toBe(0);
  });

  it("returns 1 for 'true' / 'yes'", () => {
    expect(parseTrustedProxyHops("true")).toBe(1);
    expect(parseTrustedProxyHops("TRUE")).toBe(1);
    expect(parseTrustedProxyHops("yes")).toBe(1);
  });

  it("returns the parsed positive integer", () => {
    expect(parseTrustedProxyHops("1")).toBe(1);
    expect(parseTrustedProxyHops("2")).toBe(2);
    expect(parseTrustedProxyHops("10")).toBe(10);
  });

  it("returns 0 for non-numeric or negative nonsense (fail closed)", () => {
    expect(parseTrustedProxyHops("-1")).toBe(0);
    expect(parseTrustedProxyHops("abc")).toBe(0);
    expect(parseTrustedProxyHops("1.5")).toBe(0); // reject fractional strings
    expect(parseTrustedProxyHops("2abc")).toBe(0); // reject prefixed garbage
    expect(parseTrustedProxyHops(" 1 ")).toBe(1); // surrounding whitespace OK
  });
});

describe("createRequestIpResolver", () => {
  it("returns 'unknown' regardless of headers when trustedHops = 0", () => {
    const resolve = createRequestIpResolver(0);
    const request = new Request("https://example.test", {
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1", "x-real-ip": "5.6.7.8" }
    });
    expect(resolve(request)).toBe("unknown");
  });

  it("with trustedHops = 1 takes the rightmost XFF entry (the real connection IP the proxy saw)", () => {
    const resolve = createRequestIpResolver(1);
    // Client spoofed "1.2.3.4"; proxy appended the real remote address.
    const request = new Request("https://example.test", {
      headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.5" }
    });
    expect(resolve(request)).toBe("203.0.113.5");
  });

  it("with trustedHops = 2 takes the second-to-last XFF entry", () => {
    const resolve = createRequestIpResolver(2);
    const request = new Request("https://example.test", {
      headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.5, 10.0.0.1" }
    });
    expect(resolve(request)).toBe("203.0.113.5");
  });

  it("returns 'unknown' when trustedHops exceeds XFF length (fail closed on topology mismatch)", () => {
    const resolve = createRequestIpResolver(5);
    // Only one entry, but caller claims 5 hops — can't trust any entry as the
    // last-proxy-inserted one, so don't guess.
    const request = new Request("https://example.test", {
      headers: { "x-forwarded-for": "203.0.113.5" }
    });
    expect(resolve(request)).toBe("unknown");
  });

  it("falls back to x-real-ip only when hops === 1 and XFF is absent", () => {
    const resolve = createRequestIpResolver(1);
    const request = new Request("https://example.test", {
      headers: { "x-real-ip": "198.51.100.7" }
    });
    expect(resolve(request)).toBe("198.51.100.7");
  });

  it("ignores x-real-ip when hops !== 1 (topology mismatch)", () => {
    const resolve = createRequestIpResolver(2);
    const request = new Request("https://example.test", {
      headers: { "x-real-ip": "198.51.100.7" }
    });
    expect(resolve(request)).toBe("unknown");
  });

  it("returns 'unknown' when trusted but no forwarded headers are present", () => {
    const resolve = createRequestIpResolver(1);
    const request = new Request("https://example.test");
    expect(resolve(request)).toBe("unknown");
  });

  it("trims whitespace from XFF entries", () => {
    const resolve = createRequestIpResolver(1);
    const request = new Request("https://example.test", {
      headers: { "x-forwarded-for": "   192.0.2.1   ,   10.0.0.1  " }
    });
    expect(resolve(request)).toBe("10.0.0.1");
  });
});

describe("getRequestIp (env-backed default)", () => {
  // The default resolver is bound to TRUSTED_PROXY_HOPS at module load — we can't
  // meaningfully reassign it here. Just assert the function exists and returns
  // a string. Behaviour is exercised through createRequestIpResolver above.
  it("returns a string for any Request", () => {
    expect(typeof getRequestIp(new Request("https://example.test"))).toBe("string");
  });
});

function spyOnDateNow(impl: () => number) {
  const original = Date.now;
  const stub = (() => impl()) as typeof Date.now;
  (stub as unknown as { mockRestore: () => void }).mockRestore = () => {
    Date.now = original;
  };
  (stub as unknown as { mock: boolean }).mock = true;
  Date.now = stub;
}
