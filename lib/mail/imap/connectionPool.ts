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
// - Cumulative age exceeds `MAX_CONNECTION_AGE_MS` (default 10 min) —
//   tracked from the original `connect()` time via a `WeakMap`, so repeat
//   reuse does NOT reset the cap (subtle bug Copilot caught).
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
//
// ## Runtime state lives on `globalThis`
//
// `pool` and `cleanupTimer` live under `globalThis.__noctuaImapConnectionPoolState`
// so Next.js / Turbopack dev-mode HMR can't accidentally strand a second
// copy of the pool after a module re-evaluation. Matches the convention
// already used by the circuit breaker in `imapClientOptions.ts` and the
// sync-job registry.

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
  releasedAt: number;
  lastLogContext: ImapLogContext;
  // Cleanup hook that removes our `error`/`close` listeners — invoked on evict.
  detach: () => void;
};

type PoolRuntimeState = {
  pool: Map<string, PoolEntry>;
  cleanupTimer: ReturnType<typeof setInterval> | null;
  // Original connect timestamps, keyed by ImapFlow instance. Survives
  // release-then-reacquire cycles so MAX_CONNECTION_AGE_MS actually caps
  // total lifetime rather than time-since-last-release.
  connectedAt: WeakMap<ImapFlow, number>;
};

const runtimeHost = globalThis as typeof globalThis & {
  __noctuaImapConnectionPoolState?: PoolRuntimeState;
};

if (!runtimeHost.__noctuaImapConnectionPoolState) {
  runtimeHost.__noctuaImapConnectionPoolState = {
    pool: new Map<string, PoolEntry>(),
    cleanupTimer: null,
    connectedAt: new WeakMap<ImapFlow, number>()
  };
}

const state = runtimeHost.__noctuaImapConnectionPoolState;

function scheduleCleanup() {
  if (state.cleanupTimer || state.pool.size === 0) return;
  state.cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  // Don't block Node.js process exit on this timer.
  if (typeof state.cleanupTimer.unref === "function") state.cleanupTimer.unref();
}

function runCleanup() {
  const now = Date.now();
  for (const [key, entry] of state.pool) {
    const idleFor = now - entry.releasedAt;
    const connectedAt = state.connectedAt.get(entry.client);
    const totalAge = connectedAt != null ? now - connectedAt : 0;
    if (idleFor > POOL_IDLE_MS || totalAge > MAX_CONNECTION_AGE_MS) {
      evictEntry(key, entry, "idle-timeout");
    }
  }
  if (state.pool.size === 0 && state.cleanupTimer) {
    clearInterval(state.cleanupTimer);
    state.cleanupTimer = null;
  }
}

function evictEntry(key: string, entry: PoolEntry, _reason: string) {
  state.pool.delete(key);
  entry.detach();
  state.connectedAt.delete(entry.client);
  // Fire-and-forget logout. safeLogoutImapClient swallows errors.
  void safeLogoutImapClient(entry.client, { ...entry.lastLogContext }, "pool-evict");
}

function attachErrorListeners(client: ImapFlow, key: string): () => void {
  const onError = () => {
    const current = state.pool.get(key);
    if (current && current.client === client) {
      evictEntry(key, current, "client-error");
    }
  };
  const onClose = () => {
    const current = state.pool.get(key);
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
  const cached = state.pool.get(key);
  if (cached) {
    // Remove from pool immediately so a concurrent acquire doesn't see it.
    state.pool.delete(key);
    cached.detach();
    // Trust the error listeners: if the connection had died, it would have
    // been evicted already. No explicit health check here — if the next
    // operation fails, the caller evicts via `release(..., { evict: true })`.
    return cached.client;
  }
  const client = await connectImapClient(account, logContext);
  state.connectedAt.set(client, Date.now());
  return client;
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
    state.connectedAt.delete(client);
    void safeLogoutImapClient(client, { ...logContext }, "pool-evict");
    return;
  }
  const key = buildImapIdentityKey(account);
  if (state.pool.has(key)) {
    // Slot is already taken by another concurrent release. Logout this one.
    state.connectedAt.delete(client);
    void safeLogoutImapClient(client, { ...logContext }, "pool-overflow");
    return;
  }
  // NB: we do NOT touch `state.connectedAt.get(client)` — the original
  // connect time is preserved across reuses so `MAX_CONNECTION_AGE_MS`
  // caps total lifetime, not time-since-last-release.
  const detach = attachErrorListeners(client, key);
  state.pool.set(key, {
    client,
    releasedAt: Date.now(),
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
  return state.pool.size;
}

/**
 * Log out and drop every pooled connection, awaiting each logout.
 *
 * The idle cache is a net win for a long-lived process (the Next.js
 * server), where a released connection has a good chance of being reused
 * by the next request. A short-lived one-shot process — e.g. the sync
 * worker subprocess — never gets that chance: it exits right after
 * releasing, but a pooled `ImapFlow` holds an open socket, which blocks
 * Node/Bun from exiting naturally until the idle-eviction timer catches up
 * (up to `POOL_IDLE_MS`, checked every `CLEANUP_INTERVAL_MS`). Such a
 * process should call this right before it would otherwise return.
 */
export async function drainImapConnectionPool(): Promise<void> {
  const entries = Array.from(state.pool.values());
  state.pool.clear();
  if (state.cleanupTimer) {
    clearInterval(state.cleanupTimer);
    state.cleanupTimer = null;
  }
  await Promise.all(
    entries.map((entry) => {
      entry.detach();
      state.connectedAt.delete(entry.client);
      return safeLogoutImapClient(entry.client, { ...entry.lastLogContext }, "pool-drain");
    })
  );
}

/**
 * Test helper — drops every pooled entry without logging out. Call from
 * `beforeEach` / `afterEach` in tests that create mock accounts. In
 * production this should never be invoked.
 */
export function __resetImapConnectionPoolForTests(): void {
  for (const entry of state.pool.values()) entry.detach();
  state.pool.clear();
  // WeakMap doesn't expose a clear() in all environments; it's acceptable to
  // leave stale entries here — they age out with garbage collection.
  if (state.cleanupTimer) {
    clearInterval(state.cleanupTimer);
    state.cleanupTimer = null;
  }
}

/** Test-only: read the internal connectedAt record for a client. */
export function __getConnectedAtForTests(client: ImapFlow): number | undefined {
  return state.connectedAt.get(client);
}
