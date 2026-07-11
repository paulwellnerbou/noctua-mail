import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { EventEmitter } from "node:events";
import type { ImapFlow } from "imapflow";
import type { Account } from "@/lib/data";

// We mock two dependencies the pool reaches into. `connectImapClient` is
// replaced with a fake that returns a fresh `EventEmitter`-based stub per
// call so we can observe connect count, inspect listeners, and simulate
// `error` / `close`. `safeLogoutImapClient` is stubbed to record calls.
//
// IMPORTANT: the mock factories below spread the real modules first and
// then override only the symbols we actually want to stub. An earlier
// version of this file returned a bare `{ connectImapClient }` /
// `{ buildImapIdentityKey, safeLogoutImapClient }` object from the
// factories, which silently dropped every other export from those
// modules (`buildLogContext`, `buildFolderId`, `normalizeImapInternalDate`,
// `resetImapConnectFailureState`, etc.). `bun:test` keeps mocks installed
// across files during a `test:stress` run, so later files re-importing
// any of those dropped symbols crashed with
// `SyntaxError: Export named "…" not found in module`.

// Import the real modules BEFORE installing the mocks so we can forward
// everything we don't care about.
import * as realShared from "./_shared";
import * as realImapClientOptions from "@/lib/mail/imapClientOptions";

type StubClient = ImapFlow & { __logoutCount: number };
let connectCount = 0;
let lastCreatedStub: StubClient | null = null;
const logoutCalls: StubClient[] = [];

function createStubClient(): StubClient {
  const emitter = new EventEmitter();
  const stub = emitter as unknown as StubClient;
  stub.__logoutCount = 0;
  (stub as unknown as { off?: unknown }).off = emitter.removeListener.bind(emitter);
  return stub;
}

mock.module("./_shared", () => ({
  ...realShared,
  connectImapClient: async () => {
    connectCount += 1;
    lastCreatedStub = createStubClient();
    return lastCreatedStub;
  }
}));

mock.module("@/lib/mail/imapClientOptions", () => ({
  ...realImapClientOptions,
  // `buildImapIdentityKey` is forwarded from the real module (no override).
  // We only need to stub `safeLogoutImapClient` because the real impl calls
  // `client.logout()` and `logImapOp(...)`, and our stub `ImapFlow` is a
  // plain EventEmitter.
  safeLogoutImapClient: async (client: StubClient | null | undefined) => {
    if (client) {
      client.__logoutCount += 1;
      logoutCalls.push(client);
    }
  }
}));

const {
  acquirePooledImapClient,
  releasePooledImapClient,
  withPooledImapClient,
  getImapConnectionPoolSize,
  drainImapConnectionPool,
  __resetImapConnectionPoolForTests,
  __getConnectedAtForTests
} = await import("./connectionPool");

function makeAccount(id: string): Account {
  return {
    id,
    imap: { host: "imap.example.com", port: 993, secure: true, user: "u", password: "p" },
    smtp: { host: "smtp.example.com", port: 465, secure: true, user: "u", password: "p" }
  } as unknown as Account;
}

const logCtx = { accountId: "acc-1" };

beforeEach(() => {
  connectCount = 0;
  lastCreatedStub = null;
  logoutCalls.length = 0;
  __resetImapConnectionPoolForTests();
});

afterEach(() => {
  __resetImapConnectionPoolForTests();
});

describe("acquirePooledImapClient", () => {
  test("empty pool → creates a fresh connection", async () => {
    const client = await acquirePooledImapClient(makeAccount("acc-1"), logCtx);
    expect(connectCount).toBe(1);
    expect(client).toBe(lastCreatedStub);
  });

  test("release then acquire same account → reuses cached connection", async () => {
    const account = makeAccount("acc-1");
    const first = await acquirePooledImapClient(account, logCtx);
    releasePooledImapClient(account, first, logCtx);
    expect(getImapConnectionPoolSize()).toBe(1);
    const second = await acquirePooledImapClient(account, logCtx);
    expect(second).toBe(first); // same instance reused
    expect(connectCount).toBe(1); // no new connect
    expect(getImapConnectionPoolSize()).toBe(0); // pool now empty (acquired out)
  });

  test("different accounts don't share cached connections", async () => {
    const a = makeAccount("acc-a");
    const b = makeAccount("acc-b");
    const clientA = await acquirePooledImapClient(a, { accountId: "acc-a" });
    releasePooledImapClient(a, clientA, { accountId: "acc-a" });
    const clientB = await acquirePooledImapClient(b, { accountId: "acc-b" });
    expect(clientB).not.toBe(clientA);
    expect(connectCount).toBe(2);
  });
});

describe("releasePooledImapClient", () => {
  test("evict: true → logs out without caching", async () => {
    const account = makeAccount("acc-1");
    const client = (await acquirePooledImapClient(account, logCtx)) as StubClient;
    releasePooledImapClient(account, client, logCtx, { evict: true });
    expect(client.__logoutCount).toBe(1);
    expect(getImapConnectionPoolSize()).toBe(0);
  });

  test("slot already occupied → second release logs out the loser", async () => {
    const account = makeAccount("acc-1");
    const a = (await acquirePooledImapClient(account, logCtx)) as StubClient;
    const b = (await acquirePooledImapClient(account, logCtx)) as StubClient;
    // Pool was empty both times (first acquire emptied it; second found it empty)
    // so `connectImapClient` ran twice.
    expect(a).not.toBe(b);
    expect(connectCount).toBe(2);

    // A releases first → cached
    releasePooledImapClient(account, a, logCtx);
    expect(getImapConnectionPoolSize()).toBe(1);
    expect(a.__logoutCount).toBe(0);

    // B releases second → slot is taken, so B is logged out
    releasePooledImapClient(account, b, logCtx);
    expect(getImapConnectionPoolSize()).toBe(1);
    expect(b.__logoutCount).toBe(1);
  });

  test("cached connection emitting 'error' auto-evicts", async () => {
    const account = makeAccount("acc-1");
    const client = (await acquirePooledImapClient(account, logCtx)) as StubClient;
    releasePooledImapClient(account, client, logCtx);
    expect(getImapConnectionPoolSize()).toBe(1);

    // Simulate a server-side error on the idle cached connection
    (client as unknown as EventEmitter).emit("error", new Error("boom"));

    expect(getImapConnectionPoolSize()).toBe(0);
    expect(client.__logoutCount).toBe(1);
  });

  test("cached connection emitting 'close' auto-evicts", async () => {
    const account = makeAccount("acc-1");
    const client = (await acquirePooledImapClient(account, logCtx)) as StubClient;
    releasePooledImapClient(account, client, logCtx);

    (client as unknown as EventEmitter).emit("close");

    expect(getImapConnectionPoolSize()).toBe(0);
    expect(client.__logoutCount).toBe(1);
  });

  test("error listener is removed on acquire (no phantom eviction of already-reused client)", async () => {
    const account = makeAccount("acc-1");
    const first = (await acquirePooledImapClient(account, logCtx)) as StubClient;
    releasePooledImapClient(account, first, logCtx);
    const reused = (await acquirePooledImapClient(account, logCtx)) as StubClient;
    expect(reused).toBe(first);

    // Real ImapFlow clients always have the `bindImapClientError` listener
    // attached inside `buildImapClient`, so emitting `error` never throws in
    // production. Add a no-op listener here to simulate that, then verify
    // the pool's listener was removed (no pool-driven eviction).
    (reused as unknown as EventEmitter).on("error", () => {});
    (reused as unknown as EventEmitter).emit("error", new Error("post-acquire"));
    expect(getImapConnectionPoolSize()).toBe(0);
    expect(reused.__logoutCount).toBe(0);
  });
});

describe("connection-age tracking (MAX_CONNECTION_AGE_MS cap)", () => {
  test("connectedAt is set on fresh connect and preserved across reuse", async () => {
    const account = makeAccount("acc-1");
    const first = await acquirePooledImapClient(account, logCtx);
    const firstConnectedAt = __getConnectedAtForTests(first);
    expect(typeof firstConnectedAt).toBe("number");

    releasePooledImapClient(account, first, logCtx);
    // Advance wall-clock at least 1 ms so any naive "reset on release" bug
    // would be visible.
    await new Promise((r) => setTimeout(r, 2));

    const reused = await acquirePooledImapClient(account, logCtx);
    expect(reused).toBe(first);
    const reusedConnectedAt = __getConnectedAtForTests(reused);
    // Same original timestamp — NOT reset by the release-then-reacquire cycle.
    expect(reusedConnectedAt).toBe(firstConnectedAt);
  });

  test("connectedAt is dropped when the client is evicted", async () => {
    const account = makeAccount("acc-1");
    const client = await acquirePooledImapClient(account, logCtx);
    expect(__getConnectedAtForTests(client)).toBeDefined();
    releasePooledImapClient(account, client, logCtx, { evict: true });
    expect(__getConnectedAtForTests(client)).toBeUndefined();
  });
});

describe("withPooledImapClient", () => {
  test("success path → client returns to pool", async () => {
    const account = makeAccount("acc-1");
    const result = await withPooledImapClient(account, logCtx, async (client) => {
      expect(client).toBe(lastCreatedStub);
      return 42;
    });
    expect(result).toBe(42);
    expect(getImapConnectionPoolSize()).toBe(1);
    expect((lastCreatedStub as StubClient).__logoutCount).toBe(0);
  });

  test("thrown error path → client is evicted, not returned to pool", async () => {
    const account = makeAccount("acc-1");
    const stubRef: { current: StubClient | null } = { current: null };
    await expect(
      withPooledImapClient(account, logCtx, async (client) => {
        stubRef.current = client as StubClient;
        throw new Error("op failed");
      })
    ).rejects.toThrow("op failed");
    expect(getImapConnectionPoolSize()).toBe(0);
    expect(stubRef.current?.__logoutCount).toBe(1);
  });

  test("sequential success calls reuse the cached connection", async () => {
    const account = makeAccount("acc-1");
    await withPooledImapClient(account, logCtx, async () => "first");
    await withPooledImapClient(account, logCtx, async () => "second");
    await withPooledImapClient(account, logCtx, async () => "third");
    expect(connectCount).toBe(1);
  });

  test("concurrent calls don't serialize — each gets its own client", async () => {
    const account = makeAccount("acc-1");
    const results = await Promise.all([
      withPooledImapClient(account, logCtx, async () => "a"),
      withPooledImapClient(account, logCtx, async () => "b"),
      withPooledImapClient(account, logCtx, async () => "c")
    ]);
    expect(results).toEqual(["a", "b", "c"]);
    // Two of the three had to connect fresh — first pool hit is cold, the
    // other two race and both see empty pool. So 2 or 3 connects total,
    // never just 1.
    expect(connectCount).toBeGreaterThanOrEqual(2);
    // After all three release, only one slot is kept; the others are logged
    // out. Exactly one idle entry remains.
    expect(getImapConnectionPoolSize()).toBe(1);
  });
});

describe("drainImapConnectionPool", () => {
  test("logs out and clears every pooled entry, awaiting the logout", async () => {
    const a = makeAccount("acc-a");
    const b = makeAccount("acc-b");
    const clientA = (await acquirePooledImapClient(a, { accountId: "acc-a" })) as StubClient;
    const clientB = (await acquirePooledImapClient(b, { accountId: "acc-b" })) as StubClient;
    releasePooledImapClient(a, clientA, { accountId: "acc-a" });
    releasePooledImapClient(b, clientB, { accountId: "acc-b" });
    expect(getImapConnectionPoolSize()).toBe(2);

    await drainImapConnectionPool();

    expect(getImapConnectionPoolSize()).toBe(0);
    expect(clientA.__logoutCount).toBe(1);
    expect(clientB.__logoutCount).toBe(1);
  });

  test("empty pool → resolves without error", async () => {
    expect(getImapConnectionPoolSize()).toBe(0);
    await expect(drainImapConnectionPool()).resolves.toBeUndefined();
    expect(getImapConnectionPoolSize()).toBe(0);
  });

  test("drained connection no longer auto-evicts on close (listener detached)", async () => {
    const account = makeAccount("acc-1");
    const client = (await acquirePooledImapClient(account, logCtx)) as StubClient;
    releasePooledImapClient(account, client, logCtx);
    await drainImapConnectionPool();

    // Emitting 'close' after drain must not throw or double-evict a slot
    // that's already gone.
    expect(() => (client as unknown as EventEmitter).emit("close")).not.toThrow();
    expect(getImapConnectionPoolSize()).toBe(0);
  });
});
