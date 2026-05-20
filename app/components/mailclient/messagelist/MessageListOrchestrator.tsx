import type React from "react";
import {
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from "react";
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
import { createSelectionStore, type SelectionStore } from "./selectionStore";
import type { MessageGroupMeta, VisibleMessageEntry } from "./listModel";
import type { Folder, Message } from "@/lib/data";
import type { DeleteConfirmAction, DeleteConfirmState, NoticeInput } from "../types";
import {
  useMessageMoveActions,
  type MoveMessagesToFolder,
  type UndoMoveTarget
} from "../useMessageMoveActions";
import { useMessageDeleteActions } from "../useMessageDeleteActions";
import { useMessageMutations } from "../useMessageMutations";

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
 *
 * Phase 4c additionally owns:
 *   - `selectionStore` (+ `lastSelectedIdRef`)
 *   - The three list-mutation hooks (move / delete / mutations)
 *
 * DEVIATION (phase 4c): `pendingMessageActions` stays in MailClient
 * for now — it's read from MailClient-level render helpers
 * (renderQuickActions / renderMessageMenu) and from ThreadMessageCard
 * inside `MessageViewPane`, which sits *outside* the orchestrator
 * subtree. Moving the state in would require a subscription dance
 * (useSyncExternalStore) to re-render those consumers, which isn't
 * worth the churn for this phase. The setter is threaded through as
 * a prop so the moved mutation hooks can still write it. The handle
 * re-exposes the setter for compose-send code paths that already
 * flowed it through MailClient-level state.
 *
 * Any MailClient-level consumer that still needs to reach into these
 * (keyboard shortcuts, drag hook, renderMessageMenu closures) does so
 * through `listHandleRef` — see `MessageListHandle`.
 */

/**
 * Handle published through `listHandleRef` for MailClient-level code
 * that still needs to trigger list mutations or read selection state.
 *
 * Everything exposed here has at least one caller OUTSIDE the
 * orchestrator's JSX subtree. Handlers consumed only by props going
 * into the orchestrator (e.g. `listViewActions.handleDeleteMessage`)
 * do not need to be on the handle; they stay internal.
 */
export type MessageListHandle = {
  selectionStore: SelectionStore;
  lastSelectedIdRef: React.MutableRefObject<string | null>;
  setPendingMessageActions: React.Dispatch<React.SetStateAction<Set<string>>>;
  handleArchiveMessage: (message: Message) => Promise<void>;
  handleUnsubscribe: (message: Message) => Promise<void>;
  handleDeleteMessage: (
    message: Message,
    options?: { allowThreadDeletion?: boolean }
  ) => Promise<void>;
  handleDeleteMessagesByIds: (ids: string[]) => Promise<void>;
  handleMoveMessages: (destinationFolderId: string, messageIds?: string[]) => void;
  moveMessagesToFolder: MoveMessagesToFolder;
  handleMarkSpam: (message: Message) => Promise<void>;
  handleMarkNotSpam: (message: Message) => Promise<void>;
  handleSetCategory: (
    message: Message,
    category: "newsletter" | "notification" | "transactional" | null
  ) => Promise<void>;
  updateFlagState: (
    message: Message,
    flag: "seen" | "answered" | "flagged" | "draft" | "deleted",
    value: boolean
  ) => Promise<void>;
  updateFlagStateBulk: (
    messages: Message[],
    flag: "seen" | "answered" | "flagged" | "draft" | "deleted",
    value: boolean
  ) => Promise<void>;
  updateKeywordFlag: (
    message: Message,
    keyword: string,
    value: boolean
  ) => Promise<void>;
  updateKeywordFlagBulk: (
    messages: Message[],
    keyword: string,
    value: boolean
  ) => Promise<void>;
  toggleFlaggedFlag: (
    message: Message,
    collapsedThreadMessages?: Message[]
  ) => Promise<void>;
  toggleTodoFlag: (
    message: Message,
    collapsedThreadMessages?: Message[],
    clickedBadge?: "todo" | "done"
  ) => Promise<void>;
  clearTodoFlag: (message: Message) => Promise<void>;
};

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

/**
 * The list-view state slots the caller supplies. `selectionStore` is
 * omitted because the orchestrator owns it (phase 4c) and merges it
 * in before rendering `MessageListView`. `pendingMessageActions`
 * stays on this shape — see the class-level comment for why it
 * doesn't move in phase 4c.
 */
export type MessageListOrchestratorListViewState = Omit<
  MessageListViewState,
  "selectionStore"
>;

/**
 * The list-view actions the caller supplies. `handleDeleteMessage`,
 * `toggleFlaggedFlag`, and `toggleTodoFlag` are owned by the
 * orchestrator (phase 4c — they come from the internal mutation
 * hooks) and merged in before rendering `MessageListView`.
 */
export type MessageListOrchestratorListViewActions = Omit<
  MessageListViewActions,
  "handleDeleteMessage" | "toggleFlaggedFlag" | "toggleTodoFlag"
>;

/**
 * Inputs for the three mutation hooks now owned by the orchestrator.
 *
 * Several of these fields — `messages`, `setMessages`,
 * `collapsedThreads`, `threadScopeMessages`, `visibleMessages`, and
 * `sortedMessages` — still live in `MailClient` and are threaded
 * through here so the orchestrator-owned hooks can operate on the
 * caller's message and derived list state. This wider prop surface is
 * intentional in the current design.
 */
export type MessageListOrchestratorMutationInputs = {
  activeAccountId: string;
  activeMessageId: string;
  activeFolderId: string;
  searchScope: "folder" | "all";
  includeThreadAcrossFoldersForList: boolean;
  supportsThreads: boolean;
  folders: Folder[];
  folderById: Map<string, { name: string }>;
  messages: Message[];
  threadScopeMessages: Message[];
  visibleMessages: VisibleMessageEntry[];
  sortedMessages: Message[];
  collapsedThreads: Record<string, boolean>;
  hasFilteredSearchCriteria: boolean;
  viewMessage: Message | null;
  isFlaggedMessage: (message: Message) => boolean;
  isTrashFolder: (folderId?: string | null) => boolean;
  shouldKeepMessageInCurrentResults: (message: Message) => boolean;
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setGroupMeta: React.Dispatch<React.SetStateAction<MessageGroupMeta[]>>;
  setActiveMessageId: React.Dispatch<React.SetStateAction<string>>;
  setViewMessage: (msg: Message | null) => void;
  setPendingMessageActions: React.Dispatch<React.SetStateAction<Set<string>>>;
  refreshFolders: () => Promise<unknown>;
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readErrorMessage: (res: Response) => Promise<string>;
  reportError: (message: string) => void;
  pushNotice: (input: NoticeInput) => void;
  confirmDelete: (input: DeleteConfirmState) => Promise<DeleteConfirmAction>;
  confirmUnsubscribe: (sender: string, listId?: string) => Promise<boolean>;
  undoMoveOperation: (
    targets: UndoMoveTarget[],
    accountId: string,
    successTitle?: string
  ) => Promise<void>;
  noticeSuccessTimeout: number;
  evictMessageCaches: (messageIds: string[]) => void;
  reconcileActiveTopicSuggestionRemovals: (messageIds: string[]) => void;
  setActiveTopicSuggestionMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  updateMessagesWithCurrentResultPrune: (
    updater: (message: Message) => Message | null,
    options?: { source?: string }
  ) => void;
  applyMoveReconcileSuppression: (messages: Message[]) => void;
  applyDeleteReconcileSuppression?: (input: {
    targets?: Message[];
    messageIds?: Array<string | null | undefined>;
    fallbackFolderId?: string | null;
  }) => void;
  markDeleteReconcileSuppression?: (targets: Message[]) => void;
  markMessagesMutated?: () => void;
  updateThreadCacheWithFlags: (messageId: string, flags: string[]) => void;
  updateThreadCacheWithCategory: (
    messageId: string,
    category: string | null,
    categoryScore: number | null,
    categorySignals: string[]
  ) => void;
  queueFilteredSearchRefresh: (hasCriteria: boolean) => void;
};

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

  // Out-ref for MailClient-level consumers that need to reach into
  // orchestrator-owned state (selection store, pending actions) or
  // trigger a list mutation externally (keyboard shortcuts, the drag
  // hook, renderMessageMenu closures). See `MessageListHandle` for
  // the full surface.
  listHandleRef?: React.MutableRefObject<MessageListHandle | null>;

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
  // `selectionStore` and `pendingMessageActions` are merged in by the
  // orchestrator; `handleDeleteMessage`, `toggleFlaggedFlag`, and
  // `toggleTodoFlag` come from the internal mutation hooks.
  listViewState: MessageListOrchestratorListViewState;
  listViewActions: MessageListOrchestratorListViewActions;
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

  // Inputs for the internally-owned mutation hooks. See
  // `MessageListOrchestratorMutationInputs` for the note on which
  // fields are temporary until phase 4d.
  mutationInputs: MessageListOrchestratorMutationInputs;
};

export default function MessageListOrchestrator({
  listWidth,
  scrollRef,
  defaultMessageView,
  listHandleRef,
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
  searchScope,
  mutationInputs
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

  // Selection state (phase 4c). The store itself is stable across
  // renders — seeded once via the ref guard pattern used previously in
  // MailClient — so handlers can capture it without re-running their
  // useCallbacks.
  const selectionStoreRef = useRef<SelectionStore | null>(null);
  if (!selectionStoreRef.current) {
    selectionStoreRef.current = createSelectionStore(
      mutationInputs.activeMessageId || null
    );
  }
  const selectionStore = selectionStoreRef.current;
  const lastSelectedIdRef = useRef<string | null>(null);

  const { handleMoveMessages, moveMessagesToFolder } = useMessageMoveActions({
    activeAccountId: mutationInputs.activeAccountId,
    activeMessageId: mutationInputs.activeMessageId,
    activeFolderId: mutationInputs.activeFolderId,
    searchScope: mutationInputs.searchScope,
    includeThreadAcrossFoldersForList: mutationInputs.includeThreadAcrossFoldersForList,
    messages: mutationInputs.messages,
    selectionStore,
    folderById: mutationInputs.folderById,
    lastSelectedIdRef,
    setFolders: mutationInputs.setFolders,
    setMessages: mutationInputs.setMessages,
    setGroupMeta: mutationInputs.setGroupMeta,
    shouldKeepMessageInResults: mutationInputs.shouldKeepMessageInCurrentResults,
    setPendingMessageActions: mutationInputs.setPendingMessageActions,
    setActiveMessageId: mutationInputs.setActiveMessageId,
    setViewMessage: mutationInputs.setViewMessage,
    apiFetch: mutationInputs.apiFetch,
    readErrorMessage: mutationInputs.readErrorMessage,
    reportError: mutationInputs.reportError,
    pushNotice: mutationInputs.pushNotice,
    undoMoveOperation: mutationInputs.undoMoveOperation,
    noticeSuccessTimeout: mutationInputs.noticeSuccessTimeout,
    onMoveComplete: (messageIds) => {
      mutationInputs.evictMessageCaches(messageIds);
      mutationInputs.reconcileActiveTopicSuggestionRemovals(messageIds);
    },
    markMessagesMutated: mutationInputs.markMessagesMutated,
    applyDeleteReconcileSuppression: mutationInputs.applyDeleteReconcileSuppression
  });

  const { handleDeleteMessage, handleDeleteMessagesByIds } = useMessageDeleteActions({
    activeAccountId: mutationInputs.activeAccountId,
    activeMessageId: mutationInputs.activeMessageId,
    supportsThreads: mutationInputs.supportsThreads,
    collapsedThreads: mutationInputs.collapsedThreads,
    includeFlaggedGroup: !(
      mutationInputs.searchScope === "folder" &&
      mutationInputs.isTrashFolder(mutationInputs.activeFolderId)
    ),
    searchScope: mutationInputs.searchScope,
    activeFolderId: mutationInputs.activeFolderId,
    includeThreadAcrossFoldersForList: mutationInputs.includeThreadAcrossFoldersForList,
    folders: mutationInputs.folders,
    messages: mutationInputs.messages,
    threadScopeMessages: mutationInputs.threadScopeMessages,
    visibleMessages: mutationInputs.visibleMessages,
    sortedMessages: mutationInputs.sortedMessages,
    isFlaggedMessage: mutationInputs.isFlaggedMessage,
    isTrashFolder: mutationInputs.isTrashFolder,
    moveMessagesToFolder,
    selectionStore,
    lastSelectedIdRef,
    setMessages: mutationInputs.setMessages,
    setGroupMeta: mutationInputs.setGroupMeta,
    shouldKeepMessageInResults: mutationInputs.shouldKeepMessageInCurrentResults,
    setPendingMessageActions: mutationInputs.setPendingMessageActions,
    setActiveMessageId: mutationInputs.setActiveMessageId,
    setViewMessage: mutationInputs.setViewMessage,
    refreshFolders: () => mutationInputs.refreshFolders(),
    apiFetch: mutationInputs.apiFetch,
    readErrorMessage: mutationInputs.readErrorMessage,
    reportError: mutationInputs.reportError,
    pushNotice: mutationInputs.pushNotice,
    confirmDelete: mutationInputs.confirmDelete,
    undoMoveOperation: mutationInputs.undoMoveOperation,
    noticeSuccessTimeout: mutationInputs.noticeSuccessTimeout,
    onMessagesRemoved: (messageIds) => {
      mutationInputs.evictMessageCaches(messageIds);
      mutationInputs.reconcileActiveTopicSuggestionRemovals(messageIds);
    },
    markMessagesMutated: mutationInputs.markMessagesMutated,
    markDeleteReconcileSuppression: mutationInputs.markDeleteReconcileSuppression
  });

  const {
    handleArchiveMessage,
    handleUnsubscribe,
    handleMarkSpam,
    handleMarkNotSpam,
    updateFlagState,
    updateFlagStateBulk,
    updateKeywordFlag,
    updateKeywordFlagBulk,
    handleSetCategory,
    clearTodoFlag,
    toggleTodoFlag,
    toggleFlaggedFlag
  } = useMessageMutations({
    activeAccountId: mutationInputs.activeAccountId,
    searchScope: mutationInputs.searchScope,
    viewMessage: mutationInputs.viewMessage,
    hasFilteredSearchCriteria: mutationInputs.hasFilteredSearchCriteria,
    apiFetch: mutationInputs.apiFetch,
    readErrorMessage: mutationInputs.readErrorMessage,
    reportError: mutationInputs.reportError,
    pushNotice: mutationInputs.pushNotice,
    updateMessagesWithCurrentResultPrune:
      mutationInputs.updateMessagesWithCurrentResultPrune,
    setViewMessage: mutationInputs.setViewMessage,
    setActiveMessageId: mutationInputs.setActiveMessageId,
    setFolders: mutationInputs.setFolders,
    setPendingMessageActions: mutationInputs.setPendingMessageActions,
    evictMessageCaches: mutationInputs.evictMessageCaches,
    shouldKeepMessageInCurrentResults: mutationInputs.shouldKeepMessageInCurrentResults,
    undoMoveOperation: mutationInputs.undoMoveOperation,
    confirmUnsubscribe: mutationInputs.confirmUnsubscribe,
    applyMoveReconcileSuppression: mutationInputs.applyMoveReconcileSuppression,
    setActiveTopicSuggestionMessages: mutationInputs.setActiveTopicSuggestionMessages,
    updateThreadCacheWithFlags: mutationInputs.updateThreadCacheWithFlags,
    updateThreadCacheWithCategory: mutationInputs.updateThreadCacheWithCategory,
    queueFilteredSearchRefresh: mutationInputs.queueFilteredSearchRefresh
  });

  // Publish the handle. `selectionStore` and `lastSelectedIdRef` are
  // stable; the mutation-hook outputs re-create on their own deps, so
  // we need to re-publish when any of them change identity.
  useImperativeHandle<MessageListHandle | null, MessageListHandle>(
    listHandleRef,
    () => ({
      selectionStore,
      lastSelectedIdRef,
      setPendingMessageActions: mutationInputs.setPendingMessageActions,
      handleArchiveMessage,
      handleUnsubscribe,
      handleDeleteMessage,
      handleDeleteMessagesByIds,
      handleMoveMessages,
      moveMessagesToFolder,
      handleMarkSpam,
      handleMarkNotSpam,
      handleSetCategory,
      updateFlagState,
      updateFlagStateBulk,
      updateKeywordFlag,
      updateKeywordFlagBulk,
      toggleFlaggedFlag,
      toggleTodoFlag,
      clearTodoFlag
    }),
    [
      selectionStore,
      mutationInputs.setPendingMessageActions,
      handleArchiveMessage,
      handleUnsubscribe,
      handleDeleteMessage,
      handleDeleteMessagesByIds,
      handleMoveMessages,
      moveMessagesToFolder,
      handleMarkSpam,
      handleMarkNotSpam,
      handleSetCategory,
      updateFlagState,
      updateFlagStateBulk,
      updateKeywordFlag,
      updateKeywordFlagBulk,
      toggleFlaggedFlag,
      toggleTodoFlag,
      clearTodoFlag
    ]
  );

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
          state={{
            ...listViewState,
            selectionStore
          }}
          actions={{
            ...listViewActions,
            handleDeleteMessage,
            toggleFlaggedFlag,
            toggleTodoFlag
          }}
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
