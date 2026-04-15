/**
 * Simple in-memory per-IP rate limiter.
 *
 * Each `createRateLimiter()` call returns an independent limiter with its own
 * bucket map, window size and max count.  Stale buckets are lazily cleaned up
 * every `CLEANUP_INTERVAL` checks.
 */

interface RateBucket {
  count: number;
  resetAt: number;
}

interface RateLimiterOptions {
  /** Time window in milliseconds (default: 60 000 — one minute). */
  windowMs?: number;
  /** Maximum allowed requests per window (default: 10). */
  max?: number;
}

export interface RateLimiter {
  /** Returns `true` if the IP has exceeded its budget. */
  isLimited(ip: string): boolean;
}

const CLEANUP_INTERVAL = 200; // purge stale entries every N calls

export function createRateLimiter(opts?: RateLimiterOptions): RateLimiter {
  const windowMs = opts?.windowMs ?? 60_000;
  const max = opts?.max ?? 10;
  const buckets = new Map<string, RateBucket>();
  let callsSinceCleanup = 0;

  function cleanup() {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now >= bucket.resetAt) buckets.delete(key);
    }
  }

  return {
    isLimited(ip: string): boolean {
      if (++callsSinceCleanup >= CLEANUP_INTERVAL) {
        callsSinceCleanup = 0;
        cleanup();
      }

      const now = Date.now();
      const bucket = buckets.get(ip);
      if (!bucket || now >= bucket.resetAt) {
        buckets.set(ip, { count: 1, resetAt: now + windowMs });
        return false;
      }
      bucket.count++;
      return bucket.count > max;
    }
  };
}

/**
 * Parse the `TRUSTED_PROXY_HOPS` env setting into a hop count.
 *
 * The value is the number of reverse-proxy hops whose `X-Forwarded-For` entry
 * Noctua should trust. Default (unset) is **1 hop** — Noctua's documented
 * deployment mode is behind a single reverse proxy (Caddy, nginx, …) that
 * sanitises forwarded headers. Set to `0` if Noctua is on a public interface
 * with no proxy in front; set to `2` for chained proxies (e.g. Cloudflare →
 * Caddy → Noctua).
 *
 * - Unset → 1 (single trusted proxy, the expected default)
 * - `"0"` / `"false"` / `"no"` → 0 (do NOT trust forwarded headers, bucket all
 *   requests into `"unknown"` — use this for direct-internet exposure)
 * - `"1"` / `"true"` / `"yes"` → 1
 * - Positive integer → that many hops
 * - Anything else (garbage) → 0 (fail closed)
 *
 * With a trusted reverse proxy in front, the proxy **appends** the real
 * connection IP to `X-Forwarded-For`, so the *rightmost* entry is authoritative
 * for one hop. If a client spoofs `X-Forwarded-For: 1.2.3.4`, the proxy turns
 * that into `1.2.3.4, <real-client-ip>` and we correctly pick `<real-client-ip>`.
 *
 * A well-configured proxy (see README — Caddy's `trusted_proxies` directive)
 * sanitises or rewrites the header entirely, so the point is moot, but
 * rightmost-of-N is robust either way.
 */
export function parseTrustedProxyHops(raw: string | undefined | null): number {
  if (raw == null) return 1;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return 1;
  if (normalized === "false" || normalized === "no" || normalized === "0") return 0;
  if (normalized === "true" || normalized === "yes") return 1;
  const hops = Number.parseInt(normalized, 10);
  if (!Number.isFinite(hops) || hops <= 0) return 0;
  return hops;
}

const TRUSTED_PROXY_HOPS = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS);

export interface RequestIpResolver {
  (request: Request): string;
}

/**
 * Build a request-IP resolver for the given number of trusted proxy hops.
 *
 * Exposed separately from the env-backed default so tests can exercise the
 * behaviour without mutating `process.env`.
 */
export function createRequestIpResolver(trustedHops: number): RequestIpResolver {
  if (trustedHops <= 0) {
    // Fail closed: no way to authenticate a client IP from the Request object
    // alone, so bucket everything together. Better a global rate limit than a
    // trivially bypassable per-IP one.
    return () => "unknown";
  }
  return (request: Request): string => {
    const xff = request.headers.get("x-forwarded-for");
    if (xff) {
      const entries = xff
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (entries.length > 0) {
        const idx = Math.max(0, entries.length - trustedHops);
        return entries[idx] ?? "unknown";
      }
    }
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;
    return "unknown";
  };
}

const defaultResolver = createRequestIpResolver(TRUSTED_PROXY_HOPS);

/** Extract the client IP from proxy headers, governed by TRUSTED_PROXY_HOPS. */
export function getRequestIp(request: Request): string {
  return defaultResolver(request);
}
