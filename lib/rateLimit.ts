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

/** Extract the client IP from standard proxy headers. */
export function getRequestIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}
