import type React from "react";
import type { CSSProperties } from "react";
import { CalendarDays, GitBranch, MoveRight, Paperclip, Trash2 } from "lucide-react";
import { Badge, IconButton, Text } from "@radix-ui/themes";
import { badgeColors } from "@/lib/ui/badgeColors";
import type { Message } from "@/lib/data";
import SenderIcon from "../SenderIcon";
import { CALENDAR_INVITE_FLAG, hasMessageFlag } from "@/lib/messageFlags";
import badgeStyles from "../message/MessageBadge.module.css";
import CategoryBadge from "../CategoryBadge";
import FlagBadge from "../message/FlagBadge";
import MessageBadge from "../message/MessageBadge";
import TopicBadge from "../TopicBadge";
import { shouldShowAttachmentIcon, hasTodoFlag, hasDoneFlag } from "../utils/messageHelpers";
import { getMessageListDateDisplay } from "./messageDateDisplay";
import { useSelectionSnapshot } from "./selectionStore";
import ThreadMarkers from "./ThreadMarkers";
import MessageListRenderer from "./MessageListRenderer";
import type { MessageThreadListProps } from "./messageListViewTypes";
import { useMessageListItems } from "./useMessageListItems";
import { useThreadListAnimationState } from "./useThreadListAnimationState";
import {
  getDragThreadMessageIds,
  getThreadRowDisplayMeta,
  getThreadRowSelectionMeta,
  handleCollapsedThreadRootClick,
  handleMessageRowKeyDown,
  isRowAnimatedFromGroupToggle,
  isRowAnimatedFromNestedToggle
} from "./listInteractions";
import { getCollapsedThreadBadgeUnion } from "./threadBadgeUnion";
import groupStyles from "./MessageCardList.module.css";
import styles from "./MessageThreadList.module.css";

export default function MessageThreadList({
  state,
  actions,
  helpers,
  refs
}: MessageThreadListProps) {
  const {
    groupedMessages,
    collapsedGroups,
    collapsedThreads,
    supportsThreads,
    includeThreadAcrossFolders,
    searchScope,
    activeFolderId,
    messageById,
    messageTopicsById,
    selectionStore,
    draggingMessageIds,
    pendingMessageActions,
    preferToDisplay,
    userEmail,
    dateFormat,
    topicColorRows,
    senderIconsEnabled
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
    renderFolderBadges,
    handleShowRelated,
    isTrashFolder,
    renderMessageMenu
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

  const rowHeight = 40;
  const groupHeight = 28;
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
    mode: "nested",
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
        groupTitle: groupStyles.groupTitle,
        groupToggle: groupStyles.groupToggle,
        groupTitleFlagged: groupStyles.groupTitleFlagged,
        groupCaret: groupStyles.groupCaret,
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
          lastThreadToggle?.open &&
          lastThreadToggle.key === item.threadGroupId &&
          item.depth > 0 &&
          animationClock - lastThreadToggle.at < 220;
        const animateFromNested = isRowAnimatedFromNestedToggle({
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
        const dateDisplay = getMessageListDateDisplay(
          message.dateValue,
          message.date,
          dateFormat
        );
        const isDragging = draggingMessageIds.has(message.id);
        const isActive = message.id === activeMessageId;
        const isDisabled = pendingMessageActions.has(message.id);
        const showRowDivider = index > 0 && !item.isFirstInGroup;
        const {
          rowSelected,
          showThreadSelectionActive
        } = getThreadRowSelectionMeta({
          item,
          supportsThreads,
          selectedMessageIds,
          activeMessageId: activeMessageId ?? null,
          includeSubThreadRoots: true
        });
        const isActiveThread =
          Boolean(activeMessageId) &&
          item.fullFlat.some((entry) => entry.message.id === activeMessageId);
        const showCollapsedActive =
          item.isCollapsed &&
          item.threadIndex === 0 &&
          item.depth === 0 &&
          item.threadSize > 1 &&
          isActiveThread;
        const showRootActive = showCollapsedActive || showThreadSelectionActive;
        const { isCollapsedThreadRoot, displaySeen, threadMessages } = getThreadRowDisplayMeta({
          item
        });

        // Calculate badge union for collapsed threads
        const threadBadgeUnion = getCollapsedThreadBadgeUnion({
          isCollapsedThreadRoot,
          fullFlat: item.fullFlat
        }) ?? {
          threadCategories: [],
          threadHasFlagged: false,
          threadHasTodo: false,
          threadHasDone: false,
          threadHasAttachments: false,
          threadHasCalendar: false
        };

        const rowContainerClassName = [
          styles.messageRowContainer,
          showRowDivider ? styles.rowDivider : "",
          isActive || showRootActive ? styles.rowActive : "",
          !showRootActive &&
          activeThreadKey === item.threadGroupId &&
          message.id !== activeMessage?.id
            ? styles.threadSibling
            : "",
          !displaySeen ? styles.rowUnread : "",
          rowSelected ? styles.rowSelected : "",
          isDragging ? styles.rowDragging : "",
          isDisabled ? styles.rowDisabled : ""
        ]
          .filter(Boolean)
          .join(" ");

        const firstTopicColor = topicColorRows ? (messageTopicsById?.get(message.threadId)?.[0]?.color ?? null) : null;
        const topicTintVar = firstTopicColor ? ({ "--topic-tint": `var(--${firstTopicColor}-a3)`, "--topic-tint-selected": `var(--${firstTopicColor}-a4)` } as CSSProperties) : undefined;

        return (
          <div className={rowContainerClassName} style={topicTintVar}>
            <ThreadMarkers
              depth={item.depth}
              threadIndex={item.threadIndex}
              threadSize={item.threadSize}
              isCollapsed={item.isCollapsed}
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
            <div
              className={styles.row}
              role="button"
              tabIndex={0}
              draggable
              onDragStart={(event) => {
                const threadIds = getDragThreadMessageIds({
                  isCollapsedThreadRoot,
                  fullFlat: item.fullFlat
                });
                handleMessageDragStart(event, message, threadIds);
              }}
              onDragEnd={handleMessageDragEnd}
              onClick={(event) => {
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
              onKeyDown={(event) => {
                handleMessageRowKeyDown({
                  event,
                  messageId: message.id,
                  onSelect: () => handleSelectMessage(message),
                  selectRangeTo,
                  toggleMessageSelection
                });
              }}
            >
                {item.threadIndex === 0 && item.threadSize > 1 && (
                  <Badge
                    size="1"
                    variant="soft"
                    color={badgeColors.threadIndicator}
                    className={badgeStyles.badge}
                  >
                    <GitBranch size={12} />
                    <span>{item.threadSize}</span>
                  </Badge>
                )}

                <span className={styles.cellFrom} title={item.fromTooltip}>
                  {!item.showRecipientIcon && (
                    <SenderIcon
                      accountId={message.accountId}
                      from={message.from}
                      fromEmail={message.fromEmail}
                      enabled={senderIconsEnabled}
                      className={styles.senderIcon}
                      title={item.fromTooltip}
                    />
                  )}
                  {item.showRecipientIcon && (
                    <span
                      className={styles.recipientIcon}
                      title="Recipients"
                      aria-label="Recipients"
                    >
                      <MoveRight size={12} />
                    </span>
                  )}
                  <span className={styles.cellFromText}>{item.fromText}</span>
                </span>

                <span className={styles.cellSubject}>
                  {renderUnreadDot(message, {
                    seen: displaySeen,
                    threadMessages
                  })}
                  <span className={styles.cellSubjectText}>{message.subject}</span>
                  {renderFolderBadges(item.folderIds)}
                  {(threadBadgeUnion.threadHasAttachments ||
                    shouldShowAttachmentIcon(message)) && (
                    <Badge
                      size="1"
                      variant="soft"
                      color={badgeColors.attachment}
                      className={badgeStyles.badge}
                      title="Attachments"
                      aria-label="Attachments"
                    >
                      <Paperclip size={12} />
                    </Badge>
                  )}
                  {(threadBadgeUnion.threadHasCalendar ||
                    hasMessageFlag(message.flags, CALENDAR_INVITE_FLAG)) && (
                    <Badge
                      size="1"
                      variant="soft"
                      color={badgeColors.calendarInvite}
                      className={badgeStyles.badge}
                      title="Calendar invite"
                      aria-label="Calendar invite"
                    >
                      <CalendarDays size={12} />
                    </Badge>
                  )}
                  {threadBadgeUnion.threadCategories.length > 0
                    ? threadBadgeUnion.threadCategories.map((category) => (
                        <CategoryBadge
                          key={category}
                          category={category as any}
                          showText={false}
                        />
                      ))
                    : message.category && (
                        <CategoryBadge category={message.category as any} showText={false} />
                      )}
                  {(threadBadgeUnion.threadHasFlagged || message.flagged) && (
                    <FlagBadge
                      onClick={() =>
                        toggleFlaggedFlag(
                          message,
                          isCollapsedThreadRoot ? item.fullFlat.map((entry) => entry.message) : undefined
                        )
                      }
                    />
                  )}
                  {(threadBadgeUnion.threadHasTodo || hasTodoFlag(message)) && (
                    <MessageBadge
                      kind="todo"
                      onClick={() =>
                        toggleTodoFlag(
                          message,
                          isCollapsedThreadRoot ? item.fullFlat.map((entry) => entry.message) : undefined,
                          "todo"
                        )
                      }
                    />
                  )}
                  {(threadBadgeUnion.threadHasDone || hasDoneFlag(message)) && (
                    <MessageBadge
                      kind="done"
                      onClick={() =>
                        toggleTodoFlag(
                          message,
                          isCollapsedThreadRoot ? item.fullFlat.map((entry) => entry.message) : undefined,
                          "done"
                        )
                      }
                    />
                  )}
                  {messageTopicsById?.get(message.threadId)?.map((topic) => (
                    <TopicBadge key={topic.id} topic={topic} size="1" />
                  ))}
                </span>

                <span className={styles.cellDate}>
                  <Text as="span" size="1" title={dateDisplay.tooltip}>
                    {dateDisplay.text}
                  </Text>
                </span>

                <div className={styles.cellActions}>
                  <IconButton
                    size="1"
                    variant="ghost"
                    color="gray"
                    title={
                      isTrashFolder(message.folderId)
                        ? "Delete permanently"
                        : "Move to Trash"
                    }
                    aria-label="Delete"
                    disabled={pendingMessageActions.has(message.id)}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteMessage(message);
                    }}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                  {renderMessageMenu(message, "table")}
                </div>
              </div>
            </div>
        );
      }}
    />
  );
}
