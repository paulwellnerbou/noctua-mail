"use client";

import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { buildAccountMessagesPath } from "@/lib/accountApiPaths";
import type { Folder } from "@/lib/data";
import {
  SEARCH_BADGE_ORDER,
  SEARCH_FIELD_ORDER,
  getSearchBadgeLabel,
  getSearchFieldLabel
} from "@/lib/ui/searchFilters";

type SearchFieldKey = (typeof SEARCH_FIELD_ORDER)[number];
type SearchBadgeKey = (typeof SEARCH_BADGE_ORDER)[number];
export type SearchFieldsState = Record<SearchFieldKey, boolean>;
export type SearchBadgesState = Record<SearchBadgeKey, boolean>;

export const DEFAULT_SEARCH_FIELDS: SearchFieldsState = {
  sender: true,
  participants: true,
  subject: true,
  body: true,
  attachments: true
};

export const DEFAULT_SEARCH_BADGES: SearchBadgesState = {
  unread: false,
  unanswered: false,
  flagged: false,
  todo: false,
  calendar: false,
  attachments: false,
  newsletter: false,
  notification: false,
  transactional: false
};

export type VirtualFolderDefinition = {
  id: "virtual:focused" | "virtual:action-queue" | "virtual:invite-deck";
  name: string;
  description: string;
  badgeLabel: string;
  queryBadges: readonly string[];
};

export const VIRTUAL_FOLDERS: readonly VirtualFolderDefinition[] = [
  {
    id: "virtual:focused",
    name: "Focused",
    description: "Unread, unanswered, not newsletters",
    badgeLabel: "Focused",
    queryBadges: ["focused"]
  },
  {
    id: "virtual:action-queue",
    name: "Action Queue",
    description: "To-Do & Flagged",
    badgeLabel: "Flagged or To-Do",
    queryBadges: ["attention"]
  },
  {
    id: "virtual:invite-deck",
    name: "Invite Deck",
    description: "Calendar invites",
    badgeLabel: "Calendar",
    queryBadges: ["calendar"]
  }
];

type UseSearchStateOptions = {
  activeAccountId: string;
  activeFolderId: string;
  setActiveFolderId: (folderId: string) => void;
  accountFolders: Folder[];
  folderById: Map<string, Folder>;
  query: string;
  setQuery: (query: string) => void;
  isRelatedSearch: boolean;
  relatedRestoreRef: React.MutableRefObject<{
    queryId: string;
    scope: "folder" | "all";
    folderId?: string;
  } | null>;
  relatedQueryId: string | null;
  virtualDefaultExcludedFolderIdsKey: string;
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;
  syncCompletionVersion?: number;
};

export type SearchState = {
  searchScope: "folder" | "all";
  searchFields: SearchFieldsState;
  searchBadges: SearchBadgesState;
  activeVirtualFolderId: VirtualFolderDefinition["id"] | null;
  focusedUnreadCount: number | null;
  actionQueueTodoCount: number | null;
  inviteDeckTotalCount: number | null;
  inviteDeckUnreadCount: number | null;
  activeVirtualFolder: VirtualFolderDefinition | null;
};

export type SearchActions = {
  setSearchScope: React.Dispatch<React.SetStateAction<"folder" | "all">>;
  setSearchFields: React.Dispatch<React.SetStateAction<SearchFieldsState>>;
  setSearchBadges: React.Dispatch<React.SetStateAction<SearchBadgesState>>;
  setActiveVirtualFolderId: React.Dispatch<React.SetStateAction<VirtualFolderDefinition["id"] | null>>;
  clearSearch: () => void;
  activateVirtualFolder: (virtualFolderId: string) => void;
};

export function useSearchState(options: UseSearchStateOptions) {
  const {
    activeAccountId,
    activeFolderId,
    setActiveFolderId,
    accountFolders,
    folderById,
    query,
    setQuery,
    isRelatedSearch,
    relatedRestoreRef,
    relatedQueryId,
    virtualDefaultExcludedFolderIdsKey,
    apiFetch,
    syncCompletionVersion
  } = options;

  const trimmedQuery = query.trim();
  const [searchScope, setSearchScope] = useState<"folder" | "all">("folder");
  const [searchFields, setSearchFields] = useState<SearchFieldsState>(DEFAULT_SEARCH_FIELDS);
  const [searchBadges, setSearchBadges] = useState<SearchBadgesState>(DEFAULT_SEARCH_BADGES);
  const [activeVirtualFolderId, setActiveVirtualFolderId] =
    useState<VirtualFolderDefinition["id"] | null>(null);
  const [focusedUnreadCount, setFocusedUnreadCount] = useState<number | null>(null);
  const [actionQueueTodoCount, setActionQueueTodoCount] = useState<number | null>(null);
  const [inviteDeckTotalCount, setInviteDeckTotalCount] = useState<number | null>(null);
  const [inviteDeckUnreadCount, setInviteDeckUnreadCount] = useState<number | null>(null);

  const lastFolderIdRef = useRef<string>("");

  // Reset counts when no active account
  useEffect(() => {
    if (activeAccountId) return;
    const timer = setTimeout(() => {
      setFocusedUnreadCount(null);
      setActionQueueTodoCount(null);
      setInviteDeckTotalCount(null);
      setInviteDeckUnreadCount(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeAccountId]);

  const activeVirtualFolder = useMemo(() => {
    if (!activeVirtualFolderId) return null;
    if (searchScope !== "all") return null;
    if (trimmedQuery.length > 0 || isRelatedSearch) return null;
    return VIRTUAL_FOLDERS.find((folder) => folder.id === activeVirtualFolderId) ?? null;
  }, [activeVirtualFolderId, isRelatedSearch, searchScope, trimmedQuery]);

  const clearSearch = useCallback(() => {
    const relatedRestore =
      isRelatedSearch && relatedRestoreRef.current?.queryId === relatedQueryId
        ? relatedRestoreRef.current
        : null;
    setQuery("");
    setActiveVirtualFolderId(null);
    setSearchBadges({ ...DEFAULT_SEARCH_BADGES });
    setSearchFields({ ...DEFAULT_SEARCH_FIELDS });
    if (relatedRestore?.scope === "folder") {
      setSearchScope("folder");
      setActiveFolderId(relatedRestore.folderId || accountFolders[0]?.id || "");
    } else if (isRelatedSearch) {
      setSearchScope("all");
      setActiveFolderId("");
    }
  }, [
    isRelatedSearch,
    relatedRestoreRef,
    relatedQueryId,
    setQuery,
    setActiveFolderId,
    accountFolders
  ]);

  const activateVirtualFolder = useCallback(
    (virtualFolderId: string) => {
      const virtualFolder = VIRTUAL_FOLDERS.find((folder) => folder.id === virtualFolderId);
      if (!virtualFolder) return;
      if (searchScope === "folder" && activeFolderId) {
        lastFolderIdRef.current = activeFolderId;
      }
      setActiveVirtualFolderId(virtualFolder.id);
      setQuery("");
      setSearchFields({ ...DEFAULT_SEARCH_FIELDS });
      setSearchScope("all");
      setActiveFolderId("");
      setSearchBadges({ ...DEFAULT_SEARCH_BADGES });
    },
    [activeFolderId, searchScope, setQuery, setActiveFolderId]
  );

  // Fetch virtual folder counts
  useEffect(() => {
    if (!activeAccountId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const fetchCount = async (badges: string, excludedFolderIdsKey: string) => {
        const params = new URLSearchParams({
          page: "1",
          pageSize: "1",
          groupBy: "date",
          searchScope: "all",
          badges,
          currentSearchExcludedFolderIds: excludedFolderIdsKey
        });
        const res = await apiFetch(buildAccountMessagesPath(activeAccountId, params));
        if (!res.ok) throw new Error("Failed to fetch count");
        const data = (await res.json()) as { total: number };
        return data.total;
      };
      void Promise.all([
        fetchCount("focused", virtualDefaultExcludedFolderIdsKey),
        fetchCount("todo", virtualDefaultExcludedFolderIdsKey),
        fetchCount("calendar", virtualDefaultExcludedFolderIdsKey),
        fetchCount("calendar,unread", virtualDefaultExcludedFolderIdsKey)
      ])
        .then(([focusedCount, todoCount, inviteTotalCount, inviteUnreadCount]) => {
          if (controller.signal.aborted) return;
          setFocusedUnreadCount(focusedCount);
          setActionQueueTodoCount(todoCount);
          setInviteDeckTotalCount(inviteTotalCount);
          setInviteDeckUnreadCount(inviteUnreadCount);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setFocusedUnreadCount(null);
          setActionQueueTodoCount(null);
          setInviteDeckTotalCount(null);
          setInviteDeckUnreadCount(null);
        });
    }, 160);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeAccountId, apiFetch, virtualDefaultExcludedFolderIdsKey, syncCompletionVersion]);

  // Auto-clear virtual folder when conditions change
  useEffect(() => {
    if (!activeVirtualFolderId) return;
    const shouldClear =
      searchScope !== "all" ||
      trimmedQuery.length > 0 ||
      isRelatedSearch ||
      SEARCH_BADGE_ORDER.some((badge) => searchBadges[badge]);
    if (shouldClear) {
      // Use setTimeout to avoid synchronous setState in effect
      const timer = setTimeout(() => setActiveVirtualFolderId(null), 0);
      return () => clearTimeout(timer);
    }
  }, [activeVirtualFolderId, isRelatedSearch, searchBadges, searchScope, trimmedQuery]);

  const state: SearchState = {
    searchScope,
    searchFields,
    searchBadges,
    activeVirtualFolderId,
    focusedUnreadCount,
    actionQueueTodoCount,
    inviteDeckTotalCount,
    inviteDeckUnreadCount,
    activeVirtualFolder
  };

  const actions: SearchActions = {
    setSearchScope,
    setSearchFields,
    setSearchBadges,
    setActiveVirtualFolderId,
    clearSearch,
    activateVirtualFolder
  };

  return { state, actions };
}
