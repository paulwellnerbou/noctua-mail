"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildAccountMessageActionPath,
  buildAccountMessagePath,
  buildAccountMessageSourcePath
} from "@/lib/accountApiPaths";
import type { Message } from "@/lib/data";
import { applyFlagsToMessage } from "./utils/messageHelpers";
import { THREAD_CACHE_LIMIT } from "./constants";
import { hasHtmlContent } from "@/lib/ui/messageView";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type UseThreadContentParams = {
  activeAccountId: string;
  apiFetch: ApiFetch;
  readErrorMessage: (res: Response) => Promise<string>;
  reportError: (message: string) => void;
  updateMessagesWithCurrentResultPrune: (
    updater: (message: Message) => Message | null,
    options?: { source?: string }
  ) => void;
  messageById: Map<string, Message>;
  threadMessagesRef: { current: Message[] };
};

export function useThreadContent({
  activeAccountId,
  apiFetch,
  readErrorMessage,
  reportError,
  updateMessagesWithCurrentResultPrune,
  messageById,
  threadMessagesRef
}: UseThreadContentParams) {
  const [threadRelatedMessages, setThreadRelatedMessages] = useState<Message[]>([]);
  const [threadContentById, setThreadContentById] = useState<Record<string, Message[]>>({});
  const [threadEvictVersion, setThreadEvictVersion] = useState(0);
  const [threadContentLoading, setThreadContentLoading] = useState<string | null>(null);
  const [threadContentErrorById, setThreadContentErrorById] = useState<Record<string, string>>(
    {}
  );
  const [loadingSource, setLoadingSource] = useState<Record<string, boolean>>({});
  const [messageContentLoading, setMessageContentLoading] = useState<Record<string, boolean>>({});

  const threadContentByIdRef = useRef(threadContentById);
  const threadCacheOrderRef = useRef<string[]>([]);
  const loadingSourceRef = useRef<Record<string, boolean>>({});
  const messageContentLoadingRef = useRef<Record<string, boolean>>({});
  const sourceFetchRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const autoHydrationInFlightRef = useRef<Map<string, Promise<Message | null>>>(new Map());
  const autoHydrationAttemptAtRef = useRef<Record<string, number>>({});

  useEffect(() => {
    threadContentByIdRef.current = threadContentById;
  }, [threadContentById]);

  useEffect(() => {
    loadingSourceRef.current = loadingSource;
  }, [loadingSource]);

  useEffect(() => {
    messageContentLoadingRef.current = messageContentLoading;
  }, [messageContentLoading]);

  const upsertThreadCache = useCallback((threadId: string, items: Message[]) => {
    setThreadContentById((prev) => {
      const next = { ...prev, [threadId]: items };
      const order = threadCacheOrderRef.current.filter((id) => id !== threadId);
      order.push(threadId);
      while (order.length > THREAD_CACHE_LIMIT) {
        const evict = order.shift();
        if (evict) delete next[evict];
      }
      threadCacheOrderRef.current = order;
      return next;
    });
  }, []);

  const clearThreadContentError = useCallback((threadId: string) => {
    setThreadContentErrorById((prev) => {
      if (!(threadId in prev)) return prev;
      const next = { ...prev };
      delete next[threadId];
      return next;
    });
  }, []);

  const setThreadContentError = useCallback(
    (threadId: string, message = "Failed to load message content.") => {
      setThreadContentErrorById((prev) =>
        prev[threadId] === message ? prev : { ...prev, [threadId]: message }
      );
    },
    []
  );

  const setMessageContentLoadingState = useCallback((messageId: string, loading: boolean) => {
    setMessageContentLoading((prev) => {
      const isLoading = Boolean(prev[messageId]);
      if (loading && isLoading) return prev;
      if (!loading && !isLoading) return prev;
      const next = { ...prev };
      if (loading) {
        next[messageId] = true;
      } else {
        delete next[messageId];
      }
      return next;
    });
  }, []);

  const updateThreadCacheWithMessage = useCallback((message: Message) => {
    const threadId = message.threadId ?? message.messageId ?? message.id;
    if (!threadId) return;
    setThreadContentById((prev) => {
      const cached = prev[threadId];
      if (!cached || cached.length === 0) return prev;
      let updated = false;
      let found = false;
      const nextThread = cached.map((item) => {
        if (item.id !== message.id) return item;
        found = true;
        updated = true;
        return { ...item, ...message, groupKey: item.groupKey ?? message.groupKey };
      });
      if (!found) {
        updated = true;
        nextThread.push({ ...message, groupKey: message.groupKey });
      }
      if (!updated) return prev;
      return { ...prev, [threadId]: nextThread };
    });
  }, []);

  const evictMessagesFromThreadCache = useCallback((messageIds: string[]) => {
    if (messageIds.length === 0) return;
    const idSet = new Set(messageIds);
    setThreadContentById((prev) => {
      let changed = false;
      const next: Record<string, Message[]> = { ...prev };
      Object.entries(prev).forEach(([threadId, items]) => {
        const filtered = items.filter((item) => !idSet.has(item.id));
        if (filtered.length === items.length) return;
        changed = true;
        if (filtered.length === 0) {
          delete next[threadId];
        } else {
          next[threadId] = filtered;
        }
      });
      if (!changed) return prev;
      threadCacheOrderRef.current = threadCacheOrderRef.current.filter((id) => id in next);
      return next;
    });
  }, []);

  const evictThreadCache = useCallback(
    (threadId?: string | null) => {
      if (!threadId) return;
      setThreadContentById((prev) => {
        if (!(threadId in prev)) return prev;
        const next = { ...prev };
        delete next[threadId];
        threadCacheOrderRef.current = threadCacheOrderRef.current.filter((id) => id !== threadId);
        return next;
      });
      setThreadEvictVersion((v) => v + 1);
      clearThreadContentError(threadId);
    },
    [clearThreadContentError]
  );

  const updateThreadCacheWithFlags = useCallback((messageId: string, flags: string[]) => {
    setThreadContentById((prev) => {
      let changed = false;
      const next: Record<string, Message[]> = { ...prev };
      Object.entries(prev).forEach(([threadId, list]) => {
        const idx = list.findIndex((item) => item.id === messageId);
        if (idx < 0) return;
        const updated = applyFlagsToMessage(list[idx], flags);
        const nextList = [...list];
        nextList[idx] = updated;
        next[threadId] = nextList;
        changed = true;
      });
      return changed ? next : prev;
    });
  }, []);

  const updateThreadCacheWithCategory = useCallback(
    (
      messageId: string,
      category: Message["category"],
      categoryScore: Message["categoryScore"],
      categorySignals: Message["categorySignals"]
    ) => {
      setThreadContentById((prev) => {
        let changed = false;
        const next: Record<string, Message[]> = { ...prev };
        Object.entries(prev).forEach(([threadId, list]) => {
          const idx = list.findIndex((item) => item.id === messageId);
          if (idx < 0) return;
          const current = list[idx];
          const updated = { ...current, category, categoryScore, categorySignals };
          const nextList = [...list];
          nextList[idx] = updated;
          next[threadId] = nextList;
          changed = true;
        });
        return changed ? next : prev;
      });
    },
    []
  );

  const hydrateMessageFromServer = useCallback(
    async (message: Message, options?: { silent?: boolean }) => {
      const canResync =
        message.mailboxPath &&
        typeof message.imapUid === "number" &&
        !Number.isNaN(message.imapUid);

      if (canResync) {
        try {
          const res = await apiFetch(
            buildAccountMessageActionPath(message.accountId, message.id, "resync"),
            { method: "POST" }
          );
          if (!res.ok) {
            if (!options?.silent) {
              reportError(await readErrorMessage(res));
            }
            return null;
          }
        } catch {
          if (!options?.silent) {
            reportError("Re-sync failed due to a network error.");
          }
          return null;
        }
      }

      try {
        const detailRes = await apiFetch(
          buildAccountMessagePath(message.accountId, message.id),
          { cache: "no-store" }
        );
        if (!detailRes.ok) return null;
        const detail = (await detailRes.json()) as { ok?: boolean; message?: Message };
        const hydrated = detail?.ok ? detail.message : null;
        if (!hydrated?.id) return null;

        // If the message is loaded but still empty, set a space so it's considered loaded
        if (!hasHtmlContent(hydrated.htmlBody) && (!hydrated.body || hydrated.body === "")) {
          hydrated.body = " ";
        }

        updateMessagesWithCurrentResultPrune(
          (item) => {
            if (item.id !== hydrated.id) return item;
            return {
              ...hydrated,
              // Message detail responses do not include list grouping metadata; preserve the existing group key
              // so the row remains in the same visible group after hydration.
              groupKey: item.groupKey ?? hydrated.groupKey
            };
          },
          { source: "hydrate-message-from-server" }
        );
        return hydrated;
      } catch {
        return null;
      }
    },
    [apiFetch, readErrorMessage, reportError, updateMessagesWithCurrentResultPrune]
  );

  const fetchSource = useCallback(
    async (messageId: string) => {
      const existing = sourceFetchRef.current.get(messageId);
      if (existing) {
        console.info("[noctua] fetch source reuse", { messageId });
        return existing;
      }
      console.info("[noctua] fetch source start", { messageId });
      setLoadingSource((prev) => ({ ...prev, [messageId]: true }));
      const promise = (async () => {
        const loadSource = async () => {
          const res = await apiFetch(
            buildAccountMessageSourcePath(activeAccountId, messageId)
          );
          if (!res.ok) {
            const errorMessage = await readErrorMessage(res);
            return { source: null as string | null, status: res.status, errorMessage };
          }
          const data = (await res.json()) as { source?: string };
          return { source: data.source ?? "", status: res.status, errorMessage: "" };
        };

        try {
          let result = await loadSource();
          if (!result.source && result.status === 404) {
            const message =
              messageById.get(messageId) ?? threadMessagesRef.current.find((item: Message) => item.id === messageId);
            if (message && !message.hasSource) {
              await hydrateMessageFromServer(message, { silent: true });
              result = await loadSource();
            }
          }
          if (result.source !== null) {
            console.info("[noctua] fetch source ok", { messageId, size: result.source.length });
            return result.source;
          }
          console.warn("[noctua] fetch source failed", {
            messageId,
            status: result.status,
            errorMessage: result.errorMessage
          });
          reportError(result.errorMessage || "Failed to load source.");
          return null;
        } catch (error) {
          console.warn("[noctua] fetch source exception", { messageId, error });
          reportError("Failed to load source.");
          return null;
        } finally {
          sourceFetchRef.current.delete(messageId);
          setLoadingSource((prev) => {
            const next = { ...prev };
            delete next[messageId];
            return next;
          });
        }
      })();
      sourceFetchRef.current.set(messageId, promise);
      return promise;
    },
    // apiFetch/readErrorMessage/reportError are stable props (wrapped in useCallback by the caller)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeAccountId, hydrateMessageFromServer, messageById, threadMessagesRef]
  );

  const hydrateMessageOnOpenIfNeeded = useCallback(
    (message: Message) => {
      const hasText = Boolean(message.body && message.body !== "");
      const hasHtml = hasHtmlContent(message.htmlBody);
      if (hasText || hasHtml) return null;

      const key = `${message.accountId}:${message.id}`;
      const now = Date.now();
      const lastAttempt = autoHydrationAttemptAtRef.current[key] ?? 0;
      if (now - lastAttempt < 30_000) {
        return null;
      }
      const inFlight = autoHydrationInFlightRef.current.get(key);
      if (inFlight) {
        return inFlight;
      }
      autoHydrationAttemptAtRef.current[key] = now;
      const promise = hydrateMessageFromServer(message, { silent: true }).finally(() => {
        autoHydrationInFlightRef.current.delete(key);
      });
      autoHydrationInFlightRef.current.set(key, promise);
      return promise;
    },
    [hydrateMessageFromServer]
  );

  const ensureMessageContent = useCallback(
    async (message: Message, options?: { manual?: boolean }): Promise<Message | null> => {
      const resolved = messageById.get(message.id) ?? message;
      const hasText = Boolean(resolved.body && resolved.body !== "");
      const hasHtml = hasHtmlContent(resolved.htmlBody);
      if (hasText || hasHtml) return resolved;
      if (messageContentLoadingRef.current[message.id]) return null;

      if (!options?.manual) {
        const hydrationPromise = hydrateMessageOnOpenIfNeeded(resolved);
        if (!hydrationPromise) return null;
        setMessageContentLoadingState(message.id, true);
        try {
          const hydrated = await hydrationPromise;
          if (hydrated) {
            updateThreadCacheWithMessage(hydrated);
          }
          return hydrated ?? null;
        } finally {
          setMessageContentLoadingState(message.id, false);
        }
      }

      setMessageContentLoadingState(message.id, true);
      try {
        const hydrated = await hydrateMessageFromServer(resolved);
        if (hydrated) {
          updateThreadCacheWithMessage(hydrated);
        }
        return hydrated ?? null;
      } finally {
        setMessageContentLoadingState(message.id, false);
      }
    },
    [
      hydrateMessageFromServer,
      hydrateMessageOnOpenIfNeeded,
      messageById,
      setMessageContentLoadingState,
      updateThreadCacheWithMessage
    ]
  );

  const resetThreadCache = useCallback(() => {
    setThreadContentById({});
    setThreadContentErrorById({});
    threadCacheOrderRef.current = [];
    setThreadContentLoading(null);
  }, []);

  return {
    // State
    threadRelatedMessages,
    setThreadRelatedMessages,
    threadContentById,
    setThreadContentById,
    threadEvictVersion,
    threadContentLoading,
    setThreadContentLoading,
    threadContentErrorById,
    loadingSource,
    setLoadingSource,
    messageContentLoading,
    setMessageContentLoading,
    // Refs
    threadContentByIdRef,
    loadingSourceRef,
    messageContentLoadingRef,
    sourceFetchRef,
    autoHydrationAttemptAtRef,
    // Actions
    upsertThreadCache,
    clearThreadContentError,
    setThreadContentError,
    setMessageContentLoadingState,
    updateThreadCacheWithMessage,
    evictMessagesFromThreadCache,
    evictThreadCache,
    resetThreadCache,
    updateThreadCacheWithFlags,
    updateThreadCacheWithCategory,
    hydrateMessageFromServer,
    fetchSource,
    hydrateMessageOnOpenIfNeeded,
    ensureMessageContent
  };
}
