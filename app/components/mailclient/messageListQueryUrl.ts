import {
  buildAccountMessagesPath,
  buildAccountRelatedPath,
  buildAccountSearchPath,
  buildAccountThreadsPath
} from "@/lib/accountApiPaths";
import type { MessageListSortBy } from "@/lib/messageListSort";
import { INVITE_DECK_GROUP_BY } from "@/lib/messageGrouping";
import type { ThreadDateSource } from "@/lib/threadDate";
import type { SearchBadgesState } from "./useSearchState";

/**
 * Pure URL builder for the message-list fetch. Extracted from
 * `useMessageData` so the routing logic (which endpoint + which query
 * params for the current search/thread/related mode) is testable without
 * spinning up React.
 *
 * The endpoint picker is a strict precedence cascade:
 *
 *   isRelatedSearch → `/related?relatedId=…`
 *   else supportsThreads → `/threads` (adds `threadDateSource`; `q` only if present)
 *   else query present → `/search?q=…`
 *   else → `/messages`
 *
 * Search-scope rules:
 *
 *   - "folder" + not-related → `folderId` param set to `activeFolderId`
 *   - "all" → `excludeFolderIds` param set when any are provided
 */

export type BuildMessageListQueryUrlOptions = {
  accountId: string;
  page: number;
  groupBy: string;
  searchScope: "folder" | "all";
  activeFolderId: string;
  currentSearchExcludedFolderIds: string[];
  supportsThreads: boolean;
  threadDateSource: ThreadDateSource;
  isRelatedSearch: boolean;
  relatedQueryId: string;
  query: string;
  selectedSearchFields: string[];
  searchBadges: Pick<SearchBadgesState, "attachments">;
  effectiveSearchBadges: string[];
  sortBy: MessageListSortBy;
};

export function resolveMessageListPageSize(
  groupBy: string,
  searchScope: "folder" | "all"
): number {
  if (groupBy === INVITE_DECK_GROUP_BY) return 200;
  if (searchScope === "all") return 600;
  return 300;
}

export function buildMessageListQueryUrl(opts: BuildMessageListQueryUrlOptions): string {
  const trimmedQuery = opts.query.trim();
  const pageSize = resolveMessageListPageSize(opts.groupBy, opts.searchScope);

  const params = new URLSearchParams({
    page: String(opts.page),
    pageSize: String(pageSize),
    groupBy: opts.groupBy
  });

  if (opts.supportsThreads) {
    params.set("threadDateSource", opts.threadDateSource);
  }

  if (opts.sortBy !== "date") {
    params.set("sortBy", opts.sortBy);
  }

  if (!opts.isRelatedSearch && trimmedQuery) {
    params.set("fields", opts.selectedSearchFields.join(","));
  }

  if (opts.searchBadges.attachments) {
    params.set("attachments", "1");
  }

  if (opts.effectiveSearchBadges.length > 0) {
    params.set("badges", opts.effectiveSearchBadges.join(","));
  }

  if (!opts.isRelatedSearch && opts.searchScope === "folder" && opts.activeFolderId) {
    params.set("folderId", opts.activeFolderId);
  }

  if (opts.searchScope === "all" && opts.currentSearchExcludedFolderIds.length > 0) {
    params.set("excludeFolderIds", opts.currentSearchExcludedFolderIds.join(","));
  }

  let endpointBuilder = buildAccountMessagesPath;
  if (opts.isRelatedSearch) {
    endpointBuilder = buildAccountRelatedPath;
    params.set("relatedId", opts.relatedQueryId);
  } else if (opts.supportsThreads) {
    endpointBuilder = buildAccountThreadsPath;
  } else if (trimmedQuery) {
    endpointBuilder = buildAccountSearchPath;
    params.set("q", trimmedQuery);
  }

  // Threads endpoint wants the search query too when one is set.
  if (trimmedQuery && endpointBuilder === buildAccountThreadsPath) {
    params.set("q", trimmedQuery);
  }

  return endpointBuilder(opts.accountId, params);
}
