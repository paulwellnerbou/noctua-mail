import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createRateLimiter, getRequestIp } from "./rateLimit";

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

describe("getRequestIp", () => {
  it("prefers the first entry of x-forwarded-for", () => {
    const request = new Request("https://example.test", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" }
    });
    expect(getRequestIp(request)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is missing", () => {
    const request = new Request("https://example.test", {
      headers: { "x-real-ip": "198.51.100.7" }
    });
    expect(getRequestIp(request)).toBe("198.51.100.7");
  });

  it("returns 'unknown' when no proxy headers are present", () => {
    const request = new Request("https://example.test");
    expect(getRequestIp(request)).toBe("unknown");
  });

  it("trims whitespace from the forwarded entry", () => {
    const request = new Request("https://example.test", {
      headers: { "x-forwarded-for": "   192.0.2.1   , 10.0.0.1" }
    });
    expect(getRequestIp(request)).toBe("192.0.2.1");
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
