"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import type { Message } from "@/lib/data";
import type { MessageGroupMeta } from "./messagelist/listModel";
import { computeGroupMeta } from "./utils/messageHelpers";
import {
  mergeCollapsedGroupsWithMeta,
  mergeCollapsedThreadsWithMessages
} from "./messagelist/listState";
import { mergeLoadedMessageCount, resolveLoadedMessageCount } from "./utils/listCount";
import { logListDebug, summarizeMessageForListDebug } from "./messagelist/listDebug";
import type { SearchBadgesState } from "./useSearchState";
import { INVITE_DECK_GROUP_BY } from "@/lib/messageGrouping";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const LIST_DEBUG_SAMPLE_LIMIT = 12;

export type UseMessageDataParams = {
  messagesKey: string;
  activeAccountId: string;
  searchScope: "folder" | "all";
  activeFolderId: string;
  isRelatedSearch: boolean;
  relatedQueryId: string;
  selectedSearchFields: string[];
  searchBadges: SearchBadgesState;
  effectiveSearchBadges: string[];
  currentSearchExcludedFolderIds: string[];
  supportsThreads: boolean;
  groupBy: string;
  query: string;
  authState: "loading" | "ok" | "unauth";
  apiFetch: ApiFetch;
  readErrorMessage: (res: Response) => Promise<string>;
  reportError: (message: string) => void;
  setRelatedContext: (ctx: { id: string; subject?: string } | null) => void;
  relatedContext: { id: string; subject?: string } | null;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setCollapsedThreads: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  currentKeyRef: React.MutableRefObject<string>;
};

export function useMessageData({
  messagesKey,
  activeAccountId,
  searchScope,
  activeFolderId,
  isRelatedSearch,
  relatedQueryId,
  selectedSearchFields,
  searchBadges,
  effectiveSearchBadges,
  currentSearchExcludedFolderIds,
  supportsThreads,
  groupBy,
  query,
  authState,
  apiFetch,
  readErrorMessage,
  reportError,
  setRelatedContext,
  relatedContext,
  setCollapsedGroups,
  setCollapsedThreads,
  currentKeyRef
}: UseMessageDataParams) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [groupMeta, setGroupMeta] = useState<MessageGroupMeta[]>([]);
  const [messagesPage, setMessagesPage] = useState(1);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadedMessageCount, setLoadedMessageCount] = useState(0);
  const [totalMessages, setTotalMessages] = useState<number | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [refreshingMessages, setRefreshingMessages] = useState(false);
  const [messageListError, setMessageListError] = useState<string | null>(null);

  const filteredSearchRefreshTimerRef = useRef<number | null>(null);
  const lastRequestRef = useRef<{ key: string; page: number } | null>(null);
  const messageMutationVersionRef = useRef(0);
  const listReplacementLogFingerprintRef = useRef("");

  // Cleanup filteredSearchRefreshTimer on unmount
  useEffect(() => {
    return () => {
      if (filteredSearchRefreshTimerRef.current !== null) {
        window.clearTimeout(filteredSearchRefreshTimerRef.current);
        filteredSearchRefreshTimerRef.current = null;
      }
    };
  }, []);

  // Reset list state when the query key changes
  useEffect(() => {
    if (filteredSearchRefreshTimerRef.current !== null) {
      window.clearTimeout(filteredSearchRefreshTimerRef.current);
      filteredSearchRefreshTimerRef.current = null;
    }
    setMessages([]);
    setMessagesPage(1);
    setHasMoreMessages(true);
    setLoadedMessageCount(0);
    setTotalMessages(null);
    lastRequestRef.current = null;
    setGroupMeta([]);
    setMessageListError(null);
  }, [messagesKey]);

  const logListReplacement = (
    source: string,
    prevMessages: Message[],
    nextMessages: Message[]
  ) => {
    const prevScoped = prevMessages.filter((msg) => msg.accountId === activeAccountId);
    const nextScoped = nextMessages.filter((msg) => msg.accountId === activeAccountId);
    const nextIds = new Set(nextScoped.map((msg) => msg.id));
    const removed = prevScoped.filter((msg) => !nextIds.has(msg.id));
    const foreign = nextMessages.filter((msg) => msg.accountId !== activeAccountId);
    if (removed.length === 0 && foreign.length === 0) return;
    const removedSample = removed
      .slice(0, LIST_DEBUG_SAMPLE_LIMIT)
      .map((msg) => summarizeMessageForListDebug(msg));
    const foreignSample = foreign
      .slice(0, LIST_DEBUG_SAMPLE_LIMIT)
      .map((msg) => summarizeMessageForListDebug(msg));
    const fingerprint = [
      source,
      activeAccountId,
      activeFolderId,
      searchScope,
      removed.length,
      foreign.length,
      removedSample.map((msg) => msg?.id ?? "").join(",")
    ].join("|");
    if (listReplacementLogFingerprintRef.current === fingerprint) return;
    listReplacementLogFingerprintRef.current = fingerprint;
    logListDebug("warn", "list replacement changed membership", {
      source,
      activeAccountId,
      activeFolderId,
      searchScope,
      previousCount: prevScoped.length,
      nextCount: nextScoped.length,
      removedCount: removed.length,
      foreignCount: foreign.length,
      removedSample,
      foreignSample
    });
  };

  const buildQueryParams = (page: number) => {
    const trimmedQuery = query.trim();
    const pageSize =
      groupBy === INVITE_DECK_GROUP_BY ? 200 : searchScope === "all" ? 600 : 300;
    const params = new URLSearchParams({
      accountId: activeAccountId,
      page: String(page),
      pageSize: String(pageSize),
      groupBy
    });
    if (!isRelatedSearch && trimmedQuery) {
      params.set("fields", selectedSearchFields.join(","));
    }
    if (searchBadges.attachments) {
      params.set("attachments", "1");
    }
    if (effectiveSearchBadges.length > 0) {
      params.set("badges", effectiveSearchBadges.join(","));
    }
    if (!isRelatedSearch && searchScope === "folder" && activeFolderId) {
      params.set("folderId", activeFolderId);
    }
    if (searchScope === "all" && currentSearchExcludedFolderIds.length > 0) {
      params.set("excludeFolderIds", currentSearchExcludedFolderIds.join(","));
    }
    let endpoint = trimmedQuery ? "/api/search" : "/api/messages";
    if (isRelatedSearch) {
      endpoint = "/api/related";
      params.set("relatedId", relatedQueryId);
    } else if (supportsThreads) {
      endpoint = "/api/threads";
    } else if (trimmedQuery) {
      params.set("q", trimmedQuery);
    }
    if (trimmedQuery && endpoint === "/api/threads") {
      params.set("q", trimmedQuery);
    }
    return { endpoint, params };
  };

  // Paginated message load effect.
  useEffect(() => {
    const loadMessages = async () => {
      if (!activeAccountId) return;
      if (searchScope === "folder" && !isRelatedSearch && !activeFolderId) return;
      if (loadingMessages || !hasMoreMessages) return;
      if (
        lastRequestRef.current?.key === messagesKey &&
        lastRequestRef.current?.page === messagesPage
      ) {
        return;
      }
      const requestKey = messagesKey;
      const requestMutationVersion = messageMutationVersionRef.current;
      lastRequestRef.current = { key: requestKey, page: messagesPage };
      try {
        setLoadingMessages(true);
        const { endpoint, params } = buildQueryParams(messagesPage);
        const messagesRes = await apiFetch(`${endpoint}?${params.toString()}`);
        if (messagesRes.ok) {
          const data = (await messagesRes.json()) as {
            items: Message[];
            hasMore: boolean;
            groups?: { key: string; label: string; count: number }[];
            total?: number;
            baseCount?: number;
            relatedSubject?: string;
          };
          const items = Array.isArray(data?.items) ? data.items.filter(Boolean) : [];
          const foreignItems = items.filter((item) => item.accountId !== activeAccountId);
          if (foreignItems.length > 0) {
            logListDebug("error", "list API returned foreign-account rows", {
              source: "loadMessages",
              activeAccountId,
              foreignCount: foreignItems.length,
              sample: foreignItems
                .slice(0, LIST_DEBUG_SAMPLE_LIMIT)
                .map((item) => summarizeMessageForListDebug(item))
            });
          }
          if (currentKeyRef.current !== requestKey) return;
          if (messageMutationVersionRef.current !== requestMutationVersion) {
            lastRequestRef.current = null;
            return;
          }
          if (isRelatedSearch) {
            setRelatedContext({ id: relatedQueryId, subject: data.relatedSubject });
          } else if (relatedContext) {
            setRelatedContext(null);
          }
          setMessages((prev) => {
            if (messagesPage === 1) {
              logListReplacement("loadMessages-page1", prev, items);
              return items;
            }
            const prevIds = new Set(prev.map((msg) => msg.id));
            const duplicateIncoming = items.filter((msg) => prevIds.has(msg.id));
            if (duplicateIncoming.length > 0) {
              logListDebug("warn", "paged list append contains duplicate ids", {
                source: "loadMessages-append",
                activeAccountId,
                duplicateCount: duplicateIncoming.length,
                sample: duplicateIncoming
                  .slice(0, LIST_DEBUG_SAMPLE_LIMIT)
                  .map((item) => summarizeMessageForListDebug(item))
              });
            }
            return [...prev, ...items];
          });
          setLoadedMessageCount((prev) =>
            mergeLoadedMessageCount({
              page: messagesPage,
              previousCount: prev,
              itemCount: items.length,
              baseCount: data?.baseCount
            })
          );
          setHasMoreMessages(Boolean(data?.hasMore));
          setTotalMessages(typeof data?.total === "number" ? data.total : null);
          if (messagesPage === 1) {
            const nextMeta = Array.isArray(data?.groups)
              ? data.groups
              : computeGroupMeta(items);
            setGroupMeta(nextMeta);
            setCollapsedGroups((prev) => mergeCollapsedGroupsWithMeta(prev, nextMeta));
            setCollapsedThreads((prev) => mergeCollapsedThreadsWithMessages(prev, items));
          }
          setMessageListError(null);
        } else {
          const errorMessage = await readErrorMessage(messagesRes);
          reportError(errorMessage);
          setMessageListError(errorMessage || "Failed to load messages.");
        }
      } catch {
        lastRequestRef.current = null;
        reportError("Failed to load messages.");
        setMessageListError("Failed to load messages.");
      } finally {
        setLoadingMessages(false);
      }
    };

    loadMessages();
    // Dep array intentionally omits query/searchScope/etc. — messagesKey encodes all those values;
    // the reset effect above handles key changes and triggers a fresh page-1 load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, hasMoreMessages, loadingMessages, messagesKey, messagesPage, authState]);

  const refreshMailboxData = async (): Promise<boolean> => {
    if (searchScope === "folder" && !isRelatedSearch && !activeFolderId) {
      return false;
    }
    setRefreshingMessages(true);
    const requestMutationVersion = messageMutationVersionRef.current;
    const { endpoint, params } = buildQueryParams(1);
    try {
      const messageRes = await apiFetch(`${endpoint}?${params.toString()}`);
      if (!messageRes.ok) {
        const message = await readErrorMessage(messageRes);
        reportError(message || "Failed to refresh mailbox data.");
        setMessageListError(message || "Failed to load messages.");
        return false;
      }
      const messageData = (await messageRes.json()) as {
        items: Message[];
        hasMore: boolean;
        groups?: { key: string; label: string; count: number }[];
        total?: number;
        baseCount?: number;
        relatedSubject?: string;
      };
      const nextMessages = Array.isArray(messageData?.items)
        ? messageData.items.filter(Boolean)
        : [];
      const foreignItems = nextMessages.filter((item) => item.accountId !== activeAccountId);
      if (foreignItems.length > 0) {
        logListDebug("error", "refresh returned foreign-account rows", {
          source: "refreshMailboxData",
          activeAccountId,
          foreignCount: foreignItems.length,
          sample: foreignItems
            .slice(0, LIST_DEBUG_SAMPLE_LIMIT)
            .map((item) => summarizeMessageForListDebug(item))
        });
      }
      if (messageMutationVersionRef.current !== requestMutationVersion) {
        return false;
      }
      setMessages((prev) => {
        logListReplacement("refreshMailboxData", prev, nextMessages);
        return nextMessages;
      });
      setLoadedMessageCount(
        resolveLoadedMessageCount(nextMessages.length, messageData?.baseCount)
      );
      setMessagesPage(1);
      setHasMoreMessages(Boolean(messageData?.hasMore));
      setTotalMessages(typeof messageData?.total === "number" ? messageData.total : null);
      const nextMeta = Array.isArray(messageData?.groups)
        ? messageData.groups
        : computeGroupMeta(nextMessages);
      if (isRelatedSearch) {
        setRelatedContext({ id: relatedQueryId, subject: messageData.relatedSubject });
      } else if (relatedContext) {
        setRelatedContext(null);
      }
      setGroupMeta(nextMeta);
      setCollapsedGroups((prev) => mergeCollapsedGroupsWithMeta(prev, nextMeta));
      setCollapsedThreads((prev) => mergeCollapsedThreadsWithMessages(prev, nextMessages));
      setMessageListError(null);
      return true;
    } finally {
      setRefreshingMessages(false);
    }
  };

  const queueFilteredSearchRefresh = (hasFilteredSearchCriteria: boolean) => {
    if (!hasFilteredSearchCriteria) return;
    if (filteredSearchRefreshTimerRef.current !== null) return;
    filteredSearchRefreshTimerRef.current = window.setTimeout(() => {
      filteredSearchRefreshTimerRef.current = null;
      void refreshMailboxData();
    }, 120);
  };

  const markMessagesMutated = useCallback(() => {
    messageMutationVersionRef.current += 1;
  }, []);

  return {
    messages,
    setMessages,
    groupMeta,
    setGroupMeta,
    messagesPage,
    setMessagesPage,
    hasMoreMessages,
    setHasMoreMessages,
    loadedMessageCount,
    totalMessages,
    setTotalMessages,
    loadingMessages,
    refreshingMessages,
    messageListError,
    setMessageListError,
    refreshMailboxData,
    queueFilteredSearchRefresh,
    messageMutationVersionRef,
    currentKeyRef,
    markMessagesMutated
  };
}
