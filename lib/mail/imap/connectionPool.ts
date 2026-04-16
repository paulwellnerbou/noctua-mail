// IMAP connection pool — idle-cache variant.
//
// Every fire-and-close IMAP op (poll, sync, mutation, folder listing)
// previously paid the full TLS + IMAP-auth handshake on every call. That's
// cheap on a fast LAN but measurable against real providers (50–300 ms per
// op) and adds up for interactive sessions where a single user click may
// drive several back-to-back operations.
//
// ## What this is
//
// A **single-slot idle cache keyed by account IMAP identity**. After a
// caller `release`s a connection, the pool holds it for up to
// `POOL_IDLE_MS` before logging it out. The next caller for the same
// account gets to reuse it instead of reconnecting.
//
// ## What this is NOT
//
// - **Not a pool with queuing.** If the cached slot is already in use (or
//   empty), a second concurrent caller just creates a fresh standalone
//   connection — no waiting, no serialization. The pool is purely a reuse
//   hint for the sequential-interactive case, not a resource limiter.
// - **Not used for the `/imap/stream` IDLE sessions.** Those have their
//   own per-folder lifecycle and an LRU cap (`maxIdleSessions=3`); pooling
//   them would only fight that mechanism. This pool targets the ~12
//   fire-and-close call sites in `sync.ts`, `mutations.ts`, `folders.ts`,
//   and `/imap/poll`.
//
// ## Eviction triggers
//
// - Idle for longer than `POOL_IDLE_MS` (default 60 s)
// - Connection emits `error` or `close` while cached
// - Caller explicitly requests eviction via `release(..., { evict: true })`,
//   which our `finally` blocks do when the operation itself threw
// - `__resetImapConnectionPoolForTests()` — test helper
//
// ## Identity key
//
// We key on `buildImapIdentityKey(account)` — the same JSON tuple the
// circuit breaker uses: `[accountId, host, port, secure]`. So if a user
// edits their IMAP host mid-session, the new connections land in a new
// slot and the old slot ages out.

import type { Account } from "@/lib/data";
import type { ImapFlow } from "imapflow";
import {
  buildImapIdentityKey,
  safeLogoutImapClient
} from "@/lib/mail/imapClientOptions";
import { connectImapClient, type ImapLogContext } from "./_shared";

const POOL_IDLE_MS = 60_000;
const CLEANUP_INTERVAL_MS = 15_000;
const MAX_CONNECTION_AGE_MS = 10 * 60_000;

type PoolEntry = {
  client: ImapFlow;
  acquiredAt: number;
  releasedAt: number;
  lastLogContext: ImapLogContext;
  // Cleanup hook that removes our `error`/`close` listeners — invoked on evict.
  detach: () => void;
};

// Map from identity key → currently-idle cached connection.
// Invariant: entries in this map are NOT in use. Active callers hold the
// ImapFlow reference directly; the pool slot becomes empty when acquired.
const pool = new Map<string, PoolEntry>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function scheduleCleanup() {
  if (cleanupTimer || pool.size === 0) return;
  cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  // Don't block Node.js process exit on this timer.
  if (typeof cleanupTimer.unref === "function") cleanupTimer.unref();
}

function runCleanup() {
  const now = Date.now();
  for (const [key, entry] of pool) {
    const idleFor = now - entry.releasedAt;
    const totalAge = now - entry.acquiredAt;
    if (idleFor > POOL_IDLE_MS || totalAge > MAX_CONNECTION_AGE_MS) {
      evictEntry(key, entry, "idle-timeout");
    }
  }
  if (pool.size === 0 && cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

function evictEntry(key: string, entry: PoolEntry, _reason: string) {
  pool.delete(key);
  entry.detach();
  // Fire-and-forget logout. safeLogoutImapClient swallows errors.
  void safeLogoutImapClient(entry.client, { ...entry.lastLogContext }, "pool-evict");
}

function attachErrorListeners(client: ImapFlow, key: string): () => void {
  const onError = () => {
    const current = pool.get(key);
    if (current && current.client === client) {
      evictEntry(key, current, "client-error");
    }
  };
  const onClose = () => {
    const current = pool.get(key);
    if (current && current.client === client) {
      evictEntry(key, current, "client-close");
    }
  };
  client.on("error", onError);
  client.on("close", onClose);
  return () => {
    client.off("error", onError);
    client.off("close", onClose);
  };
}

/**
 * Acquire an IMAP client for the account. Returns either a freshly
 * connected client or a recently-released one from the idle cache.
 *
 * The caller MUST eventually call `releasePooledImapClient` with the same
 * client — otherwise the connection leaks. Prefer `withPooledImapClient`
 * for a scoped wrapper that handles release automatically.
 */
export async function acquirePooledImapClient(
  account: Account,
  logContext: ImapLogContext
): Promise<ImapFlow> {
  const key = buildImapIdentityKey(account);
  const cached = pool.get(key);
  if (cached) {
    // Remove from pool immediately so a concurrent acquire doesn't see it.
    pool.delete(key);
    cached.detach();
    // Trust the error listeners: if the connection had died, it would have
    // been evicted already. No explicit health check here — if the next
    // operation fails, the caller evicts via `release(..., { evict: true })`.
    return cached.client;
  }
  return connectImapClient(account, logContext);
}

/**
 * Release an IMAP client back to the pool, or tear it down.
 *
 * - If the slot for this account is empty and `opts.evict !== true`, the
 *   connection is cached for up to POOL_IDLE_MS and may be reused.
 * - If the slot is already occupied (another concurrent release won the
 *   race), this client is logged out.
 * - If `opts.evict === true`, the client is logged out unconditionally
 *   (use this from error paths where the connection state is suspect).
 */
export function releasePooledImapClient(
  account: Account,
  client: ImapFlow,
  logContext: ImapLogContext,
  opts?: { evict?: boolean }
): void {
  if (opts?.evict) {
    void safeLogoutImapClient(client, { ...logContext }, "pool-evict");
    return;
  }
  const key = buildImapIdentityKey(account);
  if (pool.has(key)) {
    // Slot is already taken by another concurrent release. Logout this one.
    void safeLogoutImapClient(client, { ...logContext }, "pool-overflow");
    return;
  }
  const now = Date.now();
  const detach = attachErrorListeners(client, key);
  pool.set(key, {
    client,
    acquiredAt: now,
    releasedAt: now,
    lastLogContext: { ...logContext },
    detach
  });
  scheduleCleanup();
}

/**
 * Scoped helper: acquire, run the callback, release. On any error thrown
 * by `fn`, the connection is evicted (not returned to the pool) on the
 * assumption that its state is suspect. Prefer this over raw acquire/release.
 */
export async function withPooledImapClient<T>(
  account: Account,
  logContext: ImapLogContext,
  fn: (client: ImapFlow) => Promise<T>
): Promise<T> {
  const client = await acquirePooledImapClient(account, logContext);
  try {
    const result = await fn(client);
    releasePooledImapClient(account, client, logContext);
    return result;
  } catch (error) {
    releasePooledImapClient(account, client, logContext, { evict: true });
    throw error;
  }
}

/** Size of the current idle pool. For tests / telemetry. */
export function getImapConnectionPoolSize(): number {
  return pool.size;
}

/**
 * Test helper — drops every pooled entry without logging out. Call from
 * `beforeEach` / `afterEach` in tests that create mock accounts. In
 * production this should never be invoked.
 */
export function __resetImapConnectionPoolForTests(): void {
  for (const entry of pool.values()) entry.detach();
  pool.clear();
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
