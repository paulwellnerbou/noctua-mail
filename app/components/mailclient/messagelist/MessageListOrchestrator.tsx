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
 * The message-list pane: header + search banner + loading/empty states +
 * the virtualized list view, composed into one component so the parent
 * renders a single `<MessageListOrchestrator {...} />` rather than
 * assembling the subtree inline.
 *
 * Owns the view-mode state (`messageView` / the derived
 * `deferredMessageView` and `isCompactView`) because it's the only
 * consumer — the header toggles it, the list view renders against it,
 * and the pane wrapper reacts to it for compact-layout CSS. The
 * `defaultMessageView` prop lets the parent seed / override the choice
 * from user account settings.
 *
 * Sort / group / thread-date state stays with the parent: those values
 * flow into cross-cutting data-fetch memos (`sortedMessages`,
 * `useMessageData`, `useSyncController` cache keys) that live above
 * this component.
 */

/**
 * Header state fields the caller must supply. The `messageView` slot
 * from the canonical `MessageListHeaderProps["state"]` is omitted
 * because it's owned inside this component and merged in at render
 * time, so requiring it from the caller would create two sources of
 * truth.
 */
export type MessageListOrchestratorHeaderState = Omit<
  MessageListHeaderProps["state"],
  "messageView"
>;

/**
 * Header actions the caller must supply. `setMessageView` is omitted
 * for the same reason as `messageView` in the state type above —
 * toggles originate inside this component.
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

  // User's preferred default view — typically sourced from account
  // settings. The internal `messageView` state syncs to this whenever
  // it changes to a recognized value; unrecognized values (`null`,
  // `undefined`, a stored setting we don't know about) leave the
  // current view alone.
  defaultMessageView?: MessageViewMode | string | null;

  // Header state + actions minus the view-mode slice, which this
  // component owns and injects at render time.
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

  // List-view state / actions / helpers. The concrete `view` mode
  // (card / table / compact / threads) is supplied internally from
  // `messageView`, so the caller does not pass it as a separate prop.
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
  const [messageView, setMessageView] = useState<MessageViewMode>("threads");
  // `defaultMessageView` arrives asynchronously (it's resolved from the
  // user's account settings after the component first renders) and can
  // change at runtime when the user edits their layout preference — so
  // a lazy `useState` initializer would miss the first value and all
  // subsequent changes. An effect subscribes instead.
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
