import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  dispatchCalendarRemindersUpdatedEvent,
  fetchCalendarReminders
} from "./calendarReminders";

function createFakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear()
  };
}

const originalWindow = (globalThis as Record<string, unknown>).window;
const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalFetch = globalThis.fetch;

let serverFetchCount = 0;
let holdResponses = false;
let pendingReleases: Array<() => void> = [];

function releasePendingResponses() {
  const releases = pendingReleases;
  pendingReleases = [];
  holdResponses = false;
  releases.forEach((release) => release());
}

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(() => {
  (globalThis as Record<string, unknown>).window = {
    localStorage: createFakeLocalStorage(),
    dispatchEvent: () => true
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true },
    configurable: true
  });
  globalThis.fetch = (async () => {
    serverFetchCount += 1;
    if (holdResponses) {
      await new Promise<void>((resolve) => pendingReleases.push(resolve));
    }
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;
});

afterAll(() => {
  (globalThis as Record<string, unknown>).window = originalWindow;
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
  }
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  serverFetchCount = 0;
  holdResponses = false;
  pendingReleases = [];
});

describe("fetchCalendarReminders TTL cache", () => {
  // Unique per test execution: the module-level fetch state is keyed by
  // accountId and survives --rerun-each repeats.
  const uniqueAccountId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

  it("serves repeat fetches from the cache within the TTL", async () => {
    const accountId = uniqueAccountId("acc-ttl");
    await fetchCalendarReminders(accountId);
    expect(serverFetchCount).toBe(1);
    await fetchCalendarReminders(accountId);
    expect(serverFetchCount).toBe(1);
  });

  it("revalidates after a reminders-updated dispatch", async () => {
    const accountId = uniqueAccountId("acc-bust");
    await fetchCalendarReminders(accountId);
    expect(serverFetchCount).toBe(1);
    // Simulates a server-side change (event deletion, invite processing)
    // announced without a local cache write.
    dispatchCalendarRemindersUpdatedEvent();
    await fetchCalendarReminders(accountId);
    expect(serverFetchCount).toBe(2);
  });

  it("discards an in-flight request when a dispatch invalidates mid-flight", async () => {
    const accountId = uniqueAccountId("acc-inflight");
    holdResponses = true;
    const staleFetch = fetchCalendarReminders(accountId);
    await flushAsync();
    expect(serverFetchCount).toBe(1);

    dispatchCalendarRemindersUpdatedEvent();

    // The pre-dispatch request must not be reused...
    const freshFetch = fetchCalendarReminders(accountId);
    await flushAsync();
    expect(serverFetchCount).toBe(2);

    releasePendingResponses();
    await Promise.all([staleFetch, freshFetch]);

    // ...and its completion must not re-freshen the TTL: only the
    // post-dispatch request did, so this stays served from the cache.
    await fetchCalendarReminders(accountId);
    expect(serverFetchCount).toBe(2);
  });
});
