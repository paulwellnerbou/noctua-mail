"use client";

import { useCallback, useEffect, useState } from "react";
import { buildAccountTopicStatsPath, buildAccountTopicsPath } from "@/lib/accountApiPaths";
import type { Topic } from "@/lib/data";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type UseTopicsOptions = {
  activeAccountId: string;
  apiFetch: ApiFetch;
};

type TopicStatsResponse = {
  ok?: boolean;
  stats?: Array<{
    topicId?: string;
    messageCount?: number;
  }>;
};

export function useTopics({ activeAccountId, apiFetch }: UseTopicsOptions) {
  const [storedTopics, setStoredTopics] = useState<Topic[]>([]);
  const [storedTopicMessageCountById, setStoredTopicMessageCountById] =
    useState<Map<string, number>>(new Map());

  const fetchTopicMessageCounts = useCallback(async (accountId: string) => {
    try {
      const res = await apiFetch(buildAccountTopicStatsPath(accountId), { cache: "no-store" });
      const data: TopicStatsResponse = await res.json();
      if (!data.ok || !Array.isArray(data.stats)) {
        return new Map<string, number>();
      }
      return new Map(
        data.stats
          .map((stat) => [
            String(stat.topicId ?? ""),
            Number(stat.messageCount ?? 0)
          ] as const)
          .filter(([topicId]) => topicId)
      );
    } catch {
      return new Map<string, number>();
    }
  }, [apiFetch]);

  const refreshTopicStats = useCallback(async (accountId: string) => {
    setStoredTopicMessageCountById(await fetchTopicMessageCounts(accountId));
  }, [fetchTopicMessageCounts]);

  useEffect(() => {
    if (!activeAccountId) return;
    let cancelled = false;
    apiFetch(buildAccountTopicsPath(activeAccountId))
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.ok && Array.isArray(data.topics)) {
          setStoredTopics(data.topics);
        }
      })
      .catch(() => {});
    fetchTopicMessageCounts(activeAccountId)
      .then((counts) => {
        if (!cancelled) {
          setStoredTopicMessageCountById(counts);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStoredTopicMessageCountById(new Map());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeAccountId, apiFetch, fetchTopicMessageCounts]);

  const allTopics = activeAccountId ? storedTopics : [];
  const topicMessageCountById = activeAccountId ? storedTopicMessageCountById : new Map<string, number>();
  const setAllTopics = setStoredTopics;

  return {
    allTopics,
    setAllTopics,
    topicMessageCountById,
    refreshTopicStats
  };
}
