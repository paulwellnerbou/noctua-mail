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
});

describe("fetchCalendarReminders TTL cache", () => {
  it("serves repeat fetches from the cache within the TTL", async () => {
    await fetchCalendarReminders("acc-ttl");
    expect(serverFetchCount).toBe(1);
    await fetchCalendarReminders("acc-ttl");
    expect(serverFetchCount).toBe(1);
  });

  it("revalidates after a reminders-updated dispatch", async () => {
    await fetchCalendarReminders("acc-bust");
    expect(serverFetchCount).toBe(1);
    // Simulates a server-side change (event deletion, invite processing)
    // announced without a local cache write.
    dispatchCalendarRemindersUpdatedEvent();
    await fetchCalendarReminders("acc-bust");
    expect(serverFetchCount).toBe(2);
  });
});
