import type React from "react";
import type { CSSProperties } from "react";
import type { Message } from "@/lib/data";
import { CALENDAR_INVITE_FLAG, hasMessageFlag } from "@/lib/messageFlags";
import MessageRow from "./MessageRow";
import { shouldShowAttachmentIcon } from "../utils/messageHelpers";
import { useSelectionSnapshot } from "./selectionStore";
import ThreadMarkers from "./ThreadMarkers";
import MessageListRenderer from "./MessageListRenderer";
import type { MessageCardListProps } from "./messageListViewTypes";
import { useMessageListItems } from "./useMessageListItems";
import { useThreadListAnimationState } from "./useThreadListAnimationState";
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
    dateFormat,
    messageTopicsById,
    topicColorRows
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
    toggleFlaggedFlag,
    toggleTodoFlag
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
  const {
    lastGroupToggle,
    lastThreadToggle,
    lastNestedToggle,
    animationClock,
    collapsedNestedMessages,
    toggleGroup,
    toggleThread,
    toggleNested
  } = useThreadListAnimationState();

  const rowHeight = isCompactView ? 60 : 100;
  const groupHeight = isCompactView ? 28 : 32;
  const { ids: selectedMessageIds, activeId: activeMessageId } =
    useSelectionSnapshot(selectionStore);
  const activeMessage = activeMessageId ? messageById.get(activeMessageId) ?? null : null;
  const activeThreadKey =
    activeMessage?.threadId ?? activeMessage?.messageId ?? activeMessage?.id;

  const listItems = useMessageListItems({
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
  });

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
        toggleGroup(groupKey, open, setCollapsedGroups);
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
        const firstTopicColor = topicColorRows ? (messageTopicsById?.get(message.threadId)?.[0]?.color ?? null) : null;
        const topicTintVar = firstTopicColor ? ({ "--topic-tint": `var(--${firstTopicColor}-a2)`, "--topic-tint-selected": `var(--${firstTopicColor}-a3)` } as CSSProperties) : undefined;
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
          <div className={compactThreadRowClassName} style={useCompactThreadContainer ? topicTintVar : undefined}>
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
                  toggleThread(item.threadGroupId, item.isCollapsed, setCollapsedThreads);
                }}
                onToggleNested={() => {
                  toggleNested(message.id, item.isNestedCollapsed);
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
              toggleTodoFlag={toggleTodoFlag}
              threadCategories={threadBadgeUnion?.threadCategories}
              threadHasFlagged={threadBadgeUnion?.threadHasFlagged}
              threadHasTodo={threadBadgeUnion?.threadHasTodo}
              threadHasDone={threadBadgeUnion?.threadHasDone}
              threadHasAttachments={threadBadgeUnion?.threadHasAttachments}
              threadHasCalendar={threadBadgeUnion?.threadHasCalendar}
              messageTopics={messageTopicsById?.get(message.threadId)}
              collapsedThreadMessages={
                isCollapsedThreadRoot ? item.fullFlat.map((entry) => entry.message) : undefined
              }
              dateFormat={dateFormat}
              topicColorRows={topicColorRows}
            />
          </div>
        );
      }}
    />
  );

}
