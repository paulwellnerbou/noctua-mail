import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { CalendarDays, Flag, GitBranch, MoveRight, Paperclip, Trash2 } from "lucide-react";
import { Badge, IconButton, Text } from "@radix-ui/themes";
import { badgeColors, getFlagBadgeColor } from "@/lib/ui/badgeColors";
import type { Message } from "@/lib/data";
import { CALENDAR_INVITE_FLAG, hasMessageFlag, isCalendarAttachment } from "@/lib/messageFlags";
import badgeStyles from "../message/MessageBadge.module.css";
import CategoryBadge from "../CategoryBadge";
import {
  buildMessageListItems,
  type MessageGroup,
  type ThreadNode
} from "./listModel";
import { getMessageListDateDisplay } from "./messageDateDisplay";
import { useSelectionSnapshot, type SelectionStore } from "./selectionStore";
import ThreadMarkers from "./ThreadMarkers";
import MessageListRenderer from "./MessageListRenderer";
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

type MessageThreadListProps = {
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
    preferToDisplay: boolean;
    userEmail?: string;
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
    renderFolderBadges: (folderIds: string[]) => React.ReactNode;
    handleShowRelated: (message: Message) => void;
    isTrashFolder: (folderId?: string) => boolean;
    renderMessageMenu: (
      message: Message,
      view: "table" | "list",
      onOpenChange?: (open: boolean) => void
    ) => React.ReactNode;
  };
};

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
    selectionStore,
    draggingMessageIds,
    pendingMessageActions,
    preferToDisplay,
    userEmail
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
    renderFolderBadges,
    handleShowRelated,
    isTrashFolder,
    renderMessageMenu
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
  const [collapsedNestedMessages, setCollapsedNestedMessages] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!animationClock) return;
    const timer = window.setTimeout(() => setAnimationClock(0), 220);
    return () => {
      window.clearTimeout(timer);
    };
  }, [animationClock]);

  const rowHeight = 40;
  const groupHeight = 28;
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
        mode: "nested",
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
        const dateDisplay = getMessageListDateDisplay(message.dateValue, message.date);
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

        return (
          <div className={rowContainerClassName}>
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
                    (() => {
                      const nonInlineAttachments =
                        message.attachments?.filter((att) => !att.inline) ?? [];
                      if (nonInlineAttachments.length === 0) return false;
                      // Don't show attachment icon if all non-inline attachments are calendar events
                      const allCalendar = nonInlineAttachments.every(isCalendarAttachment);
                      return !allCalendar;
                    })()) && (
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
                    <Badge
                      size="1"
                      variant="soft"
                      color={getFlagBadgeColor("flagged")}
                      className={badgeStyles.badge}
                      asChild
                    >
                      <button
                        type="button"
                        className={styles.flagBadgeButton}
                        title="Unflag message"
                        aria-label="Unflag message"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleFlaggedFlag(message);
                        }}
                      >
                        <Flag size={12} />
                      </button>
                    </Badge>
                  )}
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
