// Runs only under `bun run test:dom`, which preloads happy-dom.
import { afterEach, describe, expect, it } from "bun:test";
import { useRef } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { Message } from "@/lib/data";
import { useSyncedRef } from "@/lib/ui/latestRef";
import { useMessageData } from "./useMessageData";
import { DEFAULT_SEARCH_BADGES } from "./useSearchState";

afterEach(() => cleanup());

type FetchCall = {
  url: string;
  signal: AbortSignal;
  resolve: (items: Message[]) => void;
};

// Each call stays pending until the test resolves it; an abort rejects it the
// way the browser's fetch does.
function createPendingFetch() {
  const calls: FetchCall[] = [];
  const apiFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      if (!signal) throw new Error("list requests must carry an abort signal");
      signal.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError"))
      );
      calls.push({
        url: String(input),
        signal,
        resolve: (items) =>
          resolve(
            new Response(JSON.stringify({ items, hasMore: false, total: items.length }), {
              status: 200,
              headers: { "content-type": "application/json" }
            })
          )
      });
    });
  return { calls, apiFetch };
}

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function renderMessageData(apiFetch: FetchCallFactory["apiFetch"], errors: string[]) {
  return renderHook(
    ({ query }: { query: string }) => {
      const messagesKey = `acc-1|folder|${query}`;
      const currentKeyRef = useRef(messagesKey);
      useSyncedRef(currentKeyRef, messagesKey);
      return useMessageData({
        messagesKey,
        activeAccountId: "acc-1",
        searchScope: "folder",
        activeFolderId: "acc-1:INBOX",
        isRelatedSearch: false,
        relatedQueryId: "",
        selectedSearchFields: ["subject"],
        searchBadges: DEFAULT_SEARCH_BADGES,
        effectiveSearchBadges: [],
        currentSearchExcludedFolderIds: [],
        supportsThreads: false,
        groupBy: "date",
        threadDateSource: "latestReceivedDateValue",
        sortBy: "date",
        query,
        authState: "ok",
        apiFetch,
        readErrorMessage: async () => "",
        reportError: (message) => errors.push(message),
        setRelatedContext: () => {},
        relatedContext: null,
        setCollapsedGroups: () => {},
        setCollapsedThreads: () => {},
        currentKeyRef
      });
    },
    { initialProps: { query: "e" } }
  );
}

type FetchCallFactory = ReturnType<typeof createPendingFetch>;

describe("useMessageData page requests", () => {
  it("aborts the request in flight when the key changes and fetches the new key", async () => {
    const { calls, apiFetch } = createPendingFetch();
    const errors: string[] = [];
    const { result, rerender } = renderMessageData(apiFetch, errors);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("q=e");
    expect(result.current.loadingMessages).toBe(true);

    rerender({ query: "ebay" });
    await flush();
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("q=ebay");
    expect(calls[1].signal.aborted).toBe(false);
    expect(errors).toEqual([]);
    expect(result.current.messageListError).toBeNull();

    const message = { id: "m-1", accountId: "acc-1" } as Message;
    await act(async () => {
      calls[1].resolve([message]);
    });
    await flush();
    expect(result.current.messages.map((item) => item.id)).toEqual(["m-1"]);
    expect(result.current.loadingMessages).toBe(false);
  });

  it("applies a response that was not superseded", async () => {
    const { calls, apiFetch } = createPendingFetch();
    const errors: string[] = [];
    const { result } = renderMessageData(apiFetch, errors);
    await flush();
    const message = { id: "m-2", accountId: "acc-1" } as Message;
    await act(async () => {
      calls[0].resolve([message]);
    });
    await flush();
    expect(result.current.messages.map((item) => item.id)).toEqual(["m-2"]);
    expect(result.current.totalMessages).toBe(1);
    expect(errors).toEqual([]);
  });

  it("aborts the request in flight on unmount", async () => {
    const { calls, apiFetch } = createPendingFetch();
    const { unmount } = renderMessageData(apiFetch, []);
    await flush();
    expect(calls).toHaveLength(1);
    unmount();
    expect(calls[0].signal.aborted).toBe(true);
  });
});
