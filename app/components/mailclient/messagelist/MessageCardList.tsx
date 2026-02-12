import { useEffect, useMemo, useState } from "react";
import type React from "react";
import type { AccountDateFormat, Message } from "@/lib/data";
import { CALENDAR_INVITE_FLAG, hasMessageFlag } from "@/lib/messageFlags";
import MessageRow from "./MessageRow";
import { shouldShowAttachmentIcon } from "../utils/messageHelpers";
import {
  buildMessageListItems,
  type MessageGroup,
  type ThreadNode
} from "./listModel";
import { useSelectionSnapshot, type SelectionStore } from "./selectionStore";
import ThreadMarkers from "./ThreadMarkers";
import MessageListRenderer from "./MessageListRenderer";
import {
  getDragThreadMessageIds,
  getThreadRowDisplayMeta,
  getThreadRowSelectionMeta,
  handleCollapsedThreadRootClick,
  handleMessageRowKeyDown,
  handleRowCheckboxChange,
  hasSelectionModifier,
  isRowAnimatedFromGroupToggle,
  isRowAnimatedFromNestedToggle
} from "./listInteractions";
import { getCollapsedThreadBadgeUnion } from "./threadBadgeUnion";
import styles from "./MessageCardList.module.css";
import threadRowStyles from "./MessageThreadList.module.css";

type MessageCardListProps = {
  state: {
    groupedMessages: MessageGroup[];
    collapsedGroups: Record<string, boolean>;
    collapsedThreads: Record<string, boolean>;
    supportsThreads: boolean;
    includeThreadAcrossFolders: boolean;
    searchScope: "folder" | "all";
    activeFolderId: string;
    messageById: Map<string, Message>;
    selectionStore: SelectionStore;
    draggingMessageIds: Set<string>;
    pendingMessageActions: Set<string>;
    isCompactView: boolean;
    listIsNarrow: boolean;
    preferToDisplay: boolean;
    userEmail?: string;
    dateFormat?: AccountDateFormat;
  };
  refs: {
    scrollRef: React.RefObject<HTMLDivElement | null>;
  };
  actions: {
    setCollapsedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    setCollapsedThreads: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    handleMessageDragStart: (event: React.DragEvent, message: Message, threadMessageIds?: string[]) => void;
    handleMessageDragEnd: () => void;
    handleRowClick: (event: React.MouseEvent, message: Message) => void;
    handleSelectMessage: (message: Message) => void;
    selectRangeTo: (messageId: string) => void;
    toggleMessageSelection: (messageId: string, replace?: boolean, setActive?: boolean) => void;
    selectCollapsedThread: (
      flat: Array<{ message: Message; depth: number }>,
      target: Message,
      options?: { isFlaggedGroup?: boolean }
    ) => void;
    handleDeleteMessage: (message: Message) => void;
    toggleFlaggedFlag: (message: Message) => void;
  };
  helpers: {
    buildThreadTree: (items: Message[]) => ThreadNode[];
    flattenThread: (
      node: ThreadNode,
      depth?: number,
      visited?: Set<string>
    ) => Array<{ message: Message; depth: number }>;
    getThreadLatestDate: (node: ThreadNode) => number;
    getGroupLabel: (group: MessageGroup) => React.ReactNode;
    renderUnreadDot: (
      message: Message,
      options?: { seen?: boolean; threadMessages?: Message[] }
    ) => React.ReactNode;
    renderSelectIndicators: (message: Message) => React.ReactNode;
    renderFolderBadges: (folderIds: string[]) => React.ReactNode;
    renderQuickActions: (message: Message) => React.ReactNode;
    renderMessageMenu: (
      message: Message,
      view: "table" | "list",
      onOpenChange?: (open: boolean) => void
    ) => React.ReactNode;
    handleShowRelated: (message: Message) => void;
    isTrashFolder: (folderId?: string) => boolean;
  };
};

export default function MessageCardList({
  state,
  actions,
  helpers,
  refs
}: MessageCardListProps) {
  const {
    groupedMessages,
    collapsedGroups,
    collapsedThreads,
    supportsThreads,
    includeThreadAcrossFolders,
    searchScope,
    activeFolderId,
    messageById,
    selectionStore,
    draggingMessageIds,
    pendingMessageActions,
    isCompactView,
    listIsNarrow,
    preferToDisplay,
    userEmail,
    dateFormat
  } = state;
  const { scrollRef } = refs;

  const {
    setCollapsedGroups,
    setCollapsedThreads,
    handleMessageDragStart,
    handleMessageDragEnd,
    handleRowClick,
    handleSelectMessage,
    selectRangeTo,
    toggleMessageSelection,
    selectCollapsedThread,
    handleDeleteMessage,
    toggleFlaggedFlag
  } = actions;


  const {
    buildThreadTree,
    flattenThread,
    getThreadLatestDate,
    getGroupLabel,
    renderUnreadDot,
    renderSelectIndicators,
    renderFolderBadges,
    renderQuickActions,
    renderMessageMenu,
    handleShowRelated,
    isTrashFolder
  } = helpers;
  const [lastGroupToggle, setLastGroupToggle] = useState<{
    key: string;
    open: boolean;
    at: number;
  } | null>(null);
  const [lastThreadToggle, setLastThreadToggle] = useState<{
    key: string;
    open: boolean;
    at: number;
  } | null>(null);
  const [lastNestedToggle, setLastNestedToggle] = useState<{
    key: string;
    open: boolean;
    at: number;
  } | null>(null);
  const [animationClock, setAnimationClock] = useState(0);
  const [collapsedNestedMessages, setCollapsedNestedMessages] = useState<Record<string, boolean>>(
    {}
  );

  useEffect(() => {
    if (!animationClock) return;
    const timer = window.setTimeout(() => setAnimationClock(0), 220);
    return () => {
      window.clearTimeout(timer);
    };
  }, [animationClock]);

  const rowHeight = isCompactView ? 60 : 100;
  const groupHeight = isCompactView ? 28 : 32;
  const { ids: selectedMessageIds, activeId: activeMessageId } =
    useSelectionSnapshot(selectionStore);
  const activeMessage = activeMessageId ? messageById.get(activeMessageId) ?? null : null;
  const activeThreadKey =
    activeMessage?.threadId ?? activeMessage?.messageId ?? activeMessage?.id;

  const listItems = useMemo(
    () =>
      buildMessageListItems({
        groupedMessages,
        collapsedGroups,
        collapsedThreads,
        supportsThreads,
        includeThreadAcrossFolders,
        searchScope,
        activeFolderId,
        buildThreadTree,
        flattenThread,
        getThreadLatestDate,
        userEmail,
        preferToDisplay,
        mode: isCompactView ? "nested" : "flat",
        collapsedNestedMessages
      }),
    [
      groupedMessages,
      collapsedGroups,
      collapsedThreads,
      supportsThreads,
      includeThreadAcrossFolders,
      searchScope,
      activeFolderId,
      buildThreadTree,
      flattenThread,
      getThreadLatestDate,
      userEmail,
      preferToDisplay,
      isCompactView,
      collapsedNestedMessages
    ]
  );

  return (
    <MessageListRenderer
      items={listItems}
      scrollRef={scrollRef}
      className={styles.virtualList}
      rowHeight={rowHeight}
      groupHeight={groupHeight}
      collapsedGroups={collapsedGroups}
      getGroupLabel={getGroupLabel}
      onGroupOpenChange={(groupKey, open) => {
        const at = Date.now();
        setLastGroupToggle({ key: groupKey, open, at });
        setAnimationClock(at);
        setCollapsedGroups((prev) => ({
          ...prev,
          [groupKey]: !open
        }));
      }}
      classNames={{
        virtualItem: styles.virtualItem,
        groupTitle: styles.groupTitle,
        groupToggle: styles.groupToggle,
        groupTitleFlagged: styles.groupTitleFlagged,
        groupCaret: styles.groupCaret,
        rowEnter: styles.rowEnter
      }}
      isRowAnimated={({ item }) => {
        const message = item.message;
        const animateFromGroup = isRowAnimatedFromGroupToggle({
          animationClock,
          lastGroupToggle,
          groupKey: item.groupKey
        });
        const animateFromThread =
          animationClock > 0 &&
          isCompactView &&
          lastThreadToggle?.open &&
          lastThreadToggle.key === item.threadGroupId &&
          item.depth > 0 &&
          animationClock - lastThreadToggle.at < 220;
        const animateFromNested =
          isCompactView &&
          isRowAnimatedFromNestedToggle({
            animationClock,
            lastNestedToggle,
            messageId: message.id,
            itemDepth: item.depth,
            fullFlat: item.fullFlat
          });
        return animateFromGroup || animateFromThread || animateFromNested;
      }}
      renderRow={({ item, index }) => {
        const message = item.message;
        const isActive = message.id === activeMessageId;
        const isThreadSibling =
          activeThreadKey === item.threadGroupId &&
          message.id !== activeMessage?.id;
        const isDragging = draggingMessageIds.has(message.id);
        const folderBadgeKey = item.folderIds.length ? item.folderIds.join("|") : "";
        const {
          isThreadSelectionRoot,
          threadSelectionIds,
          isThreadSelectionAllSelected,
          isThreadSelectionPartiallySelected,
          isSelected,
          rowSelected,
          checkboxState,
          showThreadSelectionActive
        } = getThreadRowSelectionMeta({
          item,
          supportsThreads,
          selectedMessageIds,
          activeMessageId: activeMessageId ?? null,
          includeSubThreadRoots: isCompactView
        });
        const isActiveThread =
          !!activeMessageId &&
          item.fullFlat.some((entry) => entry.message.id === activeMessageId);
        const showCollapsedActive =
          isCompactView &&
          item.isCollapsed &&
          item.threadIndex === 0 &&
          item.depth === 0 &&
          item.threadSize > 1 &&
          isActiveThread;
        const showRootActive = showCollapsedActive || showThreadSelectionActive;
        const showCompactDivider =
          isCompactView && index > 0 && !item.isFirstInGroup;
        const { isCollapsedThreadRoot, displaySeen, threadMessages } = getThreadRowDisplayMeta({
          item
        });
        const useCompactThreadContainer = isCompactView && supportsThreads;
        const hasExternalThreadCaret =
          useCompactThreadContainer &&
          ((item.depth === 0 && item.threadIndex === 0 && item.threadSize > 1) ||
            (item.depth > 0 && item.hasChildren));
        const compactThreadRowClassName = [
          useCompactThreadContainer
            ? `${styles.compactThreadRow} ${threadRowStyles.messageRowContainer}`
            : isCompactView
              ? styles.compactThreadRow
              : "",
          useCompactThreadContainer && showCompactDivider ? threadRowStyles.rowDivider : "",
          useCompactThreadContainer && (isActive || showRootActive)
            ? threadRowStyles.rowActive
            : "",
          useCompactThreadContainer && !showRootActive && isThreadSibling
            ? threadRowStyles.threadSibling
            : "",
          useCompactThreadContainer && !displaySeen ? threadRowStyles.rowUnread : "",
          useCompactThreadContainer && rowSelected ? threadRowStyles.rowSelected : "",
          useCompactThreadContainer && isDragging ? threadRowStyles.rowDragging : "",
          useCompactThreadContainer && pendingMessageActions.has(message.id)
            ? threadRowStyles.rowDisabled
            : ""
        ]
          .filter(Boolean)
          .join(" ");

        // Calculate badge union for collapsed threads
        const threadBadgeUnion = getCollapsedThreadBadgeUnion({
          isCollapsedThreadRoot,
          fullFlat: item.fullFlat
        });

        return (
          <div className={compactThreadRowClassName}>
            {isCompactView && supportsThreads && (
              <ThreadMarkers
                depth={item.depth}
                threadIndex={item.threadIndex}
                threadSize={item.threadSize}
                isCollapsed={item.isCollapsed}
                compactRootLayout={isCompactView}
                isLastInDepth={item.isLastInDepth}
                hasChildren={item.hasChildren}
                isNestedCollapsed={item.isNestedCollapsed}
                ancestorStopsHere={item.ancestorStopsHere}
                onToggleThread={() => {
                  const willOpen = item.isCollapsed;
                  const at = Date.now();
                  setLastThreadToggle({
                    key: item.threadGroupId,
                    open: willOpen,
                    at
                  });
                  setAnimationClock(at);
                  setCollapsedThreads((prev) => ({
                    ...prev,
                    [item.threadGroupId]: !item.isCollapsed
                  }));
                }}
                onToggleNested={() => {
                  const willOpen = item.isNestedCollapsed;
                  const at = Date.now();
                  setLastNestedToggle({
                    key: message.id,
                    open: willOpen,
                    at
                  });
                  setAnimationClock(at);
                  setCollapsedNestedMessages((prev) => ({
                    ...prev,
                    [message.id]: !item.isNestedCollapsed
                  }));
                }}
              />
            )}
            <MessageRow
              message={message}
              isCompactView={isCompactView}
              useExternalStateStyles={useCompactThreadContainer}
              subjectLeftPaddingForExternalCaret={hasExternalThreadCaret}
              listIsNarrow={listIsNarrow}
              displaySeen={displaySeen}
              isActive={isActive || showRootActive}
              isThreadChild={item.depth > 0}
              isThreadSibling={isThreadSibling}
              isSelected={rowSelected}
              isDragging={isDragging}
              isDisabled={pendingMessageActions.has(message.id)}
              showCollapsedActive={showRootActive}
              paddingLeft={isCompactView ? undefined : 14 + item.depth * 10}
              showThreadCaret={
                !isCompactView && item.threadIndex === 0 && item.threadSize > 1
              }
              isThreadCaretOpen={!item.isCollapsed}
              onThreadCaretClick={() => {
                setCollapsedThreads((prev) => ({
                  ...prev,
                  [item.threadGroupId]: !item.isCollapsed
                }));
              }}
              onRowPointerDown={() => {
                handleSelectMessage(message);
              }}
              showThreadIndicator={item.threadSize > 1 && item.threadIndex === 0}
              threadSize={item.threadSize}
              showCompactDivider={showCompactDivider}
              onRowClick={(event) => {
                handleCollapsedThreadRootClick({
                  event,
                  supportsThreads,
                  isCollapsedThreadRoot,
                  fullFlat: item.fullFlat,
                  message,
                  isFlaggedGroup: item.isFlaggedGroup,
                  selectCollapsedThread,
                  onDefault: () => handleRowClick(event, message)
                });
              }}
              onRowKeyDown={(event) => {
                handleMessageRowKeyDown({
                  event,
                  messageId: message.id,
                  onSelect: () => handleSelectMessage(message),
                  selectRangeTo,
                  toggleMessageSelection
                });
              }}
              onDragStart={(event) => {
                const threadIds = getDragThreadMessageIds({
                  isCollapsedThreadRoot,
                  fullFlat: item.fullFlat
                });
                handleMessageDragStart(event, message, threadIds);
              }}
              onDragEnd={handleMessageDragEnd}
              onCheckboxChange={(shiftKey) => {
                handleRowCheckboxChange({
                  shiftKey,
                  messageId: message.id,
                  isThreadSelectionRoot,
                  selectedMessageIds,
                  threadSelectionIds,
                  isThreadSelectionAllSelected,
                  selectionStore,
                  selectRangeTo,
                  toggleMessageSelection
                });
              }}
              checkboxState={checkboxState}
              onSubjectClick={(event) => {
                event.stopPropagation();
                handleCollapsedThreadRootClick({
                  event,
                  supportsThreads,
                  isCollapsedThreadRoot,
                  fullFlat: item.fullFlat,
                  message,
                  isFlaggedGroup: item.isFlaggedGroup,
                  selectCollapsedThread,
                  onDefault: () => {
                    if (hasSelectionModifier(event)) {
                      handleRowClick(event, message);
                    } else {
                      handleSelectMessage(message);
                    }
                  }
                });
              }}
              onDelete={(event) => {
                event.stopPropagation();
                handleDeleteMessage(message);
              }}
              onShowRelated={(event) => {
                event.stopPropagation();
                handleShowRelated(message);
              }}
              deleteTitle={
                isTrashFolder(message.folderId)
                  ? "Delete permanently"
                  : "Move to Trash"
              }
              renderUnreadDot={renderUnreadDot(message, {
                seen: displaySeen,
                threadMessages
              })}
              renderSelectIndicators={renderSelectIndicators(message)}
              fromText={item.fromText}
              fromTooltip={item.fromTooltip}
              showRecipientIcon={item.showRecipientIcon}
              folderBadges={renderFolderBadges(item.folderIds)}
              folderBadgeKey={folderBadgeKey}
              showFolderBadgesInSubjectMeta
              showFolderBadgesInMeta={false}
              quickActions={renderQuickActions(message)}
              messageMenu={renderMessageMenu(message, isCompactView ? "table" : "list")}
              showAttachmentIcon={shouldShowAttachmentIcon(message)}
              showCalendarInviteIcon={hasMessageFlag(message.flags, CALENDAR_INVITE_FLAG)}
              showNewBadge={
                !displaySeen &&
                Boolean(message.recent) &&
                !Boolean(message.draft)
              }
              categoryIcon={(() => {
                const categoryIcons: Record<string, string> = {
                  newsletter: "📰",
                  marketing: "🏷️",
                  notification: "🔔",
                  transactional: "🧾"
                };
                return message.category ? categoryIcons[message.category] : undefined;
              })()}
              toggleFlaggedFlag={toggleFlaggedFlag}
              threadCategories={threadBadgeUnion?.threadCategories}
              threadHasFlagged={threadBadgeUnion?.threadHasFlagged}
              threadHasAttachments={threadBadgeUnion?.threadHasAttachments}
              threadHasCalendar={threadBadgeUnion?.threadHasCalendar}
              dateFormat={dateFormat}
            />
          </div>
        );
      }}
    />
  );

}
