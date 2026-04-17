import type React from "react";
import { useDeferredValue, useEffect, useState } from "react";
import { Badge, Card, Flex, IconButton, Text } from "@radix-ui/themes";
import { Search, X } from "lucide-react";

import listMetaStyles from "./MessageListMeta.module.css";
import listPaneStyles from "./MessageListPane.module.css";

import MessageListHeader, { type MessageListHeaderProps } from "./MessageListHeader";
import MessageListPane from "./MessageListPane";
import MessageListView from "./MessageListView";
import {
  MESSAGE_VIEW_MODES,
  type MessageListViewActions,
  type MessageListViewHelpers,
  type MessageListViewState,
  type MessageViewMode
} from "./messageListViewTypes";

function isValidMessageViewMode(value: unknown): value is MessageViewMode {
  return (
    typeof value === "string" &&
    (MESSAGE_VIEW_MODES as readonly string[]).includes(value)
  );
}

/**
 * Composes `<MessageListPane>` + `<MessageListHeader>` + search card +
 * loading/empty states + `<MessageListView>` into one component, so
 * `MailClient.tsx` renders a single `<MessageListOrchestrator {...} />`
 * instead of carrying ~180 lines of inline JSX.
 *
 * ## State the orchestrator owns (expanded over time)
 *
 * - **Phase 4a ([PR #48]):** pure JSX skeleton — no state moved yet.
 *   Every value still flows in as props.
 * - **Phase 4b (this PR):** owns the **view-mode** cluster —
 *   `messageView` / `deferredMessageView` / the derived `isCompactView`,
 *   plus the effect that picks up the user's preferred default view
 *   from account settings. `MailClient.tsx` no longer carries those
 *   identifiers at all.
 * - **Later (4c/4d/…):** sort / selection / mutation hooks move in
 *   the same shape. `sortKey`/`groupBy`/`threadDateSource` don't move
 *   yet because they feed cross-cutting memos (sortedMessages,
 *   useMessageData, sync keys) that live above the orchestrator.
 */

/**
 * Header state fields that MailClient still owns. Compared to
 * `MessageListHeaderProps["state"]`, this drops `messageView` because
 * the orchestrator now owns it internally and feeds it into the header
 * at render time.
 */
export type MessageListOrchestratorHeaderState = Omit<
  MessageListHeaderProps["state"],
  "messageView"
>;

/**
 * Header actions MailClient still owns. Drops `setMessageView` for the
 * same reason.
 */
export type MessageListOrchestratorHeaderActions = Omit<
  MessageListHeaderProps["actions"],
  "setMessageView"
>;

export type MessageListOrchestratorProps = {
  // Pane width; drives the fixed width on the pane container.
  listWidth: number;

  // Scroll container ref. Attached to the pane's scrolling `<aside>` AND
  // passed to the list view as its `scrollRef` — the virtualization logic
  // reads scroll offsets from the same element the pane rendered. These
  // two consumers are always the same element, so the orchestrator takes
  // a single ref and distributes it internally rather than exposing two
  // props that could diverge.
  scrollRef: React.RefObject<HTMLDivElement | null>;

  // The user's preferred default view, read from account settings by
  // `MailClient`. When it changes (e.g. user edits their layout
  // preference), the orchestrator resets its internal `messageView`
  // to match. `null` / `undefined` / any other value leaves the
  // current view unchanged.
  defaultMessageView?: MessageViewMode | string | null;

  // Header (state + actions), minus the view-mode slice that the
  // orchestrator now owns.
  header: {
    state: MessageListOrchestratorHeaderState;
    actions: MessageListOrchestratorHeaderActions;
  };

  // Search-banner UI (only rendered when `searchActive || isRelatedSearch`).
  searchActive: boolean;
  isRelatedSearch: boolean;
  relatedNotice: string;
  searchCriteriaLabel: string;
  searchCriteriaBadges: Array<{ key: string; label: string }>;
  onClearSearch: () => void;

  // List-view state / actions / helpers. The concrete `view` mode is
  // derived internally from `messageView` — MailClient no longer passes
  // it in.
  listViewState: MessageListViewState;
  listViewActions: MessageListViewActions;
  listViewHelpers: MessageListViewHelpers;

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
  scrollRef,
  defaultMessageView,
  header,
  searchActive,
  isRelatedSearch,
  relatedNotice,
  searchCriteriaLabel,
  searchCriteriaBadges,
  onClearSearch,
  listViewState,
  listViewActions,
  listViewHelpers,
  showListLoadingState,
  listLoading,
  sortedMessagesCount,
  filteredMessagesCount,
  messageListError,
  emptyListSyncing,
  activeVirtualFolderName,
  searchScope
}: MessageListOrchestratorProps) {
  // View-mode state the orchestrator now owns (P1-12 Phase 4b).
  const [messageView, setMessageView] = useState<MessageViewMode>("threads");
  // Sync to the user's preferred default view when it arrives / changes.
  // We use a useEffect rather than deriving `useState(() => defaultMessageView)`
  // because the preferred-view setting is loaded asynchronously (it comes
  // from the account settings once the account is resolved) and may change
  // at runtime when the user edits their layout preferences.
  useEffect(() => {
    if (isValidMessageViewMode(defaultMessageView)) {
      setMessageView(defaultMessageView);
    }
  }, [defaultMessageView]);
  // Render the list with a deferred value so rapid header toggles (e.g.
  // keyboard shortcuts stepping through views) don't block the UI while
  // the new view's layout computes.
  const deferredMessageView = useDeferredValue(messageView);
  const isCompactView = deferredMessageView === "compact";

  return (
    <MessageListPane state={{ listWidth }} refs={{ listPaneRef: scrollRef }}>
      <div
        className={`${listPaneStyles.list} ${isCompactView ? listPaneStyles.listCompact : ""}`}
      >
        <MessageListHeader
          state={{ ...header.state, messageView }}
          actions={{ ...header.actions, setMessageView }}
        />

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
          view={deferredMessageView}
          state={listViewState}
          actions={listViewActions}
          helpers={listViewHelpers}
          refs={{ scrollRef }}
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
