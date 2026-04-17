import type React from "react";
import { Badge, Card, Flex, IconButton, Text } from "@radix-ui/themes";
import { Search, X } from "lucide-react";

import listMetaStyles from "./MessageListMeta.module.css";
import listPaneStyles from "./MessageListPane.module.css";

import MessageListHeader, { type MessageListHeaderProps } from "./MessageListHeader";
import MessageListPane from "./MessageListPane";
import MessageListView from "./MessageListView";
import type {
  MessageListViewActions,
  MessageListViewHelpers,
  MessageListViewProps,
  MessageListViewRefs,
  MessageListViewState
} from "./messageListViewTypes";

/**
 * Composes `<MessageListPane>` + `<MessageListHeader>` + search card +
 * loading/empty states + `<MessageListView>` into one component, so
 * `MailClient.tsx` renders a single `<MessageListOrchestrator {...} />`
 * instead of carrying ~180 lines of inline JSX.
 *
 * **Phase 4a (CLEANUP P1-12):** this is a pure JSX extraction. State
 * still lives in `MailClient.tsx` and flows in as props. Subsequent
 * phases will pull state up into this file one cluster at a time
 * (sort/group/view, selection, mutations, etc.) until the orchestrator
 * genuinely owns the list's lifecycle.
 *
 * Zero behavior change: the JSX subtree and the prop pipelines it feeds
 * are copied verbatim from `MailClient.tsx`.
 */

export type MessageListOrchestratorProps = {
  // Pane container + scroll ref (passed to MessageListPane and to the
  // list view as its scrollRef).
  listWidth: number;
  listPaneRef: React.RefObject<HTMLDivElement | null>;

  // Whether the current view is the "compact" card layout — affects the
  // pane wrapper CSS.
  isCompactView: boolean;

  // Header (state + actions). Shape comes from `MessageListHeader`.
  header: MessageListHeaderProps;

  // Search-banner UI (only rendered when `searchActive || isRelatedSearch`).
  searchActive: boolean;
  isRelatedSearch: boolean;
  relatedNotice: string;
  searchCriteriaLabel: string;
  searchCriteriaBadges: Array<{ key: string; label: string }>;
  onClearSearch: () => void;

  // The list view itself.
  view: MessageListViewProps["view"];
  listViewState: MessageListViewState;
  listViewActions: MessageListViewActions;
  listViewHelpers: MessageListViewHelpers;
  listViewRefs: MessageListViewRefs;

  // Loading + empty-state banners.
  showListLoadingState: boolean;
  listLoading: boolean;
  sortedMessagesCount: number;
  filteredMessagesCount: number;
  messageListError: string | null;
  emptyListSyncing: boolean;
  activeVirtualFolderName?: string;
  searchScope: "folder" | "all";
};

export default function MessageListOrchestrator({
  listWidth,
  listPaneRef,
  isCompactView,
  header,
  searchActive,
  isRelatedSearch,
  relatedNotice,
  searchCriteriaLabel,
  searchCriteriaBadges,
  onClearSearch,
  view,
  listViewState,
  listViewActions,
  listViewHelpers,
  listViewRefs,
  showListLoadingState,
  listLoading,
  sortedMessagesCount,
  filteredMessagesCount,
  messageListError,
  emptyListSyncing,
  activeVirtualFolderName,
  searchScope
}: MessageListOrchestratorProps) {
  return (
    <MessageListPane state={{ listWidth }} refs={{ listPaneRef }}>
      <div
        className={`${listPaneStyles.list} ${isCompactView ? listPaneStyles.listCompact : ""}`}
      >
        <MessageListHeader state={header.state} actions={header.actions} />

        {(searchActive || isRelatedSearch) && (
          <Card size="1" className={listMetaStyles.searchCard}>
            <Flex
              align="center"
              justify="between"
              gap="3"
              className={listMetaStyles.searchRow}
            >
              <Flex align="center" gap="2" className={listMetaStyles.searchSummary}>
                <Search size={12} />
                {isRelatedSearch ? (
                  <Text size="1" color="gray">
                    {relatedNotice}
                  </Text>
                ) : (
                  <>
                    <Text size="1" color="gray">
                      Searching
                    </Text>
                    <div
                      className={listMetaStyles.searchCriteria}
                      aria-label={searchCriteriaLabel || "all messages"}
                      title={searchCriteriaLabel || "All messages"}
                    >
                      {searchCriteriaBadges.map((badge) => (
                        <Badge
                          key={badge.key}
                          size="1"
                          variant="soft"
                          color="gray"
                          className={listMetaStyles.searchBadge}
                          title={badge.label}
                        >
                          <span className={listMetaStyles.searchBadgeLabel}>{badge.label}</span>
                        </Badge>
                      ))}
                    </div>
                  </>
                )}
              </Flex>
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                onClick={onClearSearch}
                title="Clear search"
                aria-label="Clear search"
              >
                <X size={12} />
              </IconButton>
            </Flex>
          </Card>
        )}

        {showListLoadingState && sortedMessagesCount === 0 && (
          <Card size="1" className={listMetaStyles.loadingCard}>
            <Text size="1" color="gray">
              Loading messages…
            </Text>
          </Card>
        )}

        <MessageListView
          view={view}
          state={listViewState}
          actions={listViewActions}
          helpers={listViewHelpers}
          refs={listViewRefs}
        />

        {filteredMessagesCount === 0 && !showListLoadingState && (
          <div
            className={`${listPaneStyles.empty} ${
              messageListError ? listPaneStyles.emptyError : ""
            }`}
          >
            {messageListError
              ? `Failed to load messages. ${messageListError}`
              : emptyListSyncing
                ? "Syncing messages…"
                : activeVirtualFolderName
                  ? `No messages in ${activeVirtualFolderName}.`
                  : searchScope === "all"
                    ? "No messages match this search."
                    : "No messages in this folder."}
          </div>
        )}

        {listLoading && sortedMessagesCount > 0 && (
          <Card size="1" className={listMetaStyles.loadingCard}>
            <Text size="1" color="gray">
              Loading more…
            </Text>
          </Card>
        )}
      </div>
    </MessageListPane>
  );
}
