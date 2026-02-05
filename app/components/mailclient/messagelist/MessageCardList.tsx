import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { Message } from "@/lib/data";
import { CALENDAR_INVITE_FLAG, hasMessageFlag } from "@/lib/messageFlags";
import { Text } from "@radix-ui/themes";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CaretRightIcon } from "@radix-ui/react-icons";
import MessageRow from "./MessageRow";
import {
  buildFlatEntries,
  buildThreadGroupEntries,
  getCollapsedThreadFromDisplay,
  getMessageFromDisplay
} from "./threadGroupUtils";
import { useSelectionSnapshot, type SelectionStore } from "./selectionStore";
import styles from "./MessageCardList.module.css";

type MessageGroup = {
  key: string;
  label?: string;
  items: Message[];
  count?: number;
};

type ThreadNode = { message: Message; children: ThreadNode[]; threadSize: number };

type ListGroupItem = {
  type: "group";
  key: string;
  group: MessageGroup;
};

type ListRowItem = {
  type: "row";
  key: string;
  groupKey: string;
  isFirstInGroup: boolean;
  message: Message;
  depth: number;
  threadGroupId: string;
  threadSize: number;
  isCollapsed: boolean;
  isPinnedGroup: boolean;
  threadIndex: number;
  fullFlat: Array<{ message: Message; depth: number }>;
  folderIds: string[];
  fromText: string;
  fromTooltip: string;
};

type ListItem = ListGroupItem | ListRowItem;

const OVERSCAN_COUNT = 8;

const findStartIndex = (offsets: number[], value: number) => {
  if (offsets.length === 0) return 0;
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsets[mid] <= value) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return Math.max(0, lo - 1);
};

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
    userEmail?: string;
  };
  refs: {
    scrollRef: React.RefObject<HTMLDivElement | null>;
  };
  actions: {
    setCollapsedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    setCollapsedThreads: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    handleMessageDragStart: (event: React.DragEvent, message: Message) => void;
    handleMessageDragEnd: () => void;
    handleRowClick: (event: React.MouseEvent, message: Message) => void;
    handleSelectMessage: (message: Message) => void;
    selectRangeTo: (messageId: string) => void;
    toggleMessageSelection: (messageId: string, replace?: boolean) => void;
    selectCollapsedThread: (
      flat: Array<{ message: Message; depth: number }>,
      target: Message
    ) => void;
    handleDeleteMessage: (message: Message) => void;
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
    renderUnreadDot: (message: Message) => React.ReactNode;
    renderSelectIndicators: (message: Message) => React.ReactNode;
    renderFolderBadges: (folderIds: string[]) => React.ReactNode;
    renderQuickActions: (message: Message) => React.ReactNode;
    renderMessageMenu: (
      message: Message,
      view: "table" | "list",
      onOpenChange?: (open: boolean) => void
    ) => React.ReactNode;
    handleShowRelated: (message: Message) => void;
    isPinnedMessage: (message: Message) => boolean;
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
    handleDeleteMessage
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
    isPinnedMessage,
    isTrashFolder
  } = helpers;


  const listRef = useRef<HTMLDivElement | null>(null);
  const lastGroupToggleRef = useRef<{ key: string; open: boolean; at: number } | null>(null);
  const [scrollState, setScrollState] = useState({ scrollTop: 0, height: 0 });

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const containerTop = listRef.current
        ? listRef.current.getBoundingClientRect().top -
          scrollEl.getBoundingClientRect().top +
          scrollEl.scrollTop
        : 0;
      const nextTop = Math.max(0, scrollEl.scrollTop - containerTop);
      const nextHeight = scrollEl.clientHeight;
      setScrollState((prev) =>
        prev.scrollTop === nextTop && prev.height === nextHeight
          ? prev
          : { scrollTop: nextTop, height: nextHeight }
      );
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };
    update();
    scrollEl.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scrollEl.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [scrollRef]);

  const rowHeight = isCompactView ? 60 : 120;
  const groupHeight = isCompactView ? 28 : 32;
  const { ids: selectedMessageIds, activeId: activeMessageId } =
    useSelectionSnapshot(selectionStore);
  const activeMessage = activeMessageId ? messageById.get(activeMessageId) ?? null : null;
  const activeThreadKey =
    activeMessage?.threadId ?? activeMessage?.messageId ?? activeMessage?.id;

  const listItems = useMemo(() => {
    const items: ListItem[] = [];
    groupedMessages.forEach((group) => {
      items.push({ type: "group", key: group.key, group });
      if (group.items.length === 0 || collapsedGroups[group.key]) return;
      let isFirstRow = true;

      if (supportsThreads) {
        const entries = buildThreadGroupEntries({
          group,
          collapsedThreads,
          includeThreadAcrossFolders,
          searchScope,
          activeFolderId,
          buildThreadTree,
          flattenThread,
          getThreadLatestDate
        });
        entries.forEach((entry) => {
          const {
            threadGroupId,
            threadSize,
            isCollapsed,
            fullFlat,
            flat,
            threadFolderIds,
            showThreadFolderBadges
          } = entry;
          const collapsedThreadFrom =
            isCollapsed && threadSize > 1 ? getCollapsedThreadFromDisplay(fullFlat, userEmail) : null;
          flat.forEach(({ message, depth }, index) => {
            const folderIds =
              index === 0 && isCollapsed && threadSize > 1
                ? showThreadFolderBadges
                  ? threadFolderIds
                  : []
                : searchScope === "all" ||
                    (includeThreadAcrossFolders &&
                      message.folderId !== activeFolderId)
                  ? [message.folderId]
                  : [];
            // For expanded threads (depth > 0 or index > 0), pass isInExpandedThread=true
            const isInExpandedThread = !isCollapsed || index > 0;
            const fromDisplay =
              index === 0 && collapsedThreadFrom
                ? collapsedThreadFrom
                : getMessageFromDisplay(message.from, message.to, userEmail, isInExpandedThread);
            items.push({
              type: "row",
              key: message.id,
              groupKey: group.key,
              isFirstInGroup: isFirstRow,
              message,
              depth,
              threadGroupId,
              threadSize,
              isCollapsed,
              isPinnedGroup: group.key === "Pinned",
              threadIndex: index,
              fullFlat,
              folderIds,
              fromText: fromDisplay.text,
              fromTooltip: fromDisplay.tooltip
            });
            if (isFirstRow) isFirstRow = false;
          });
        });
        return;
      }

      buildFlatEntries({
        group,
        includeThreadAcrossFolders,
        searchScope,
        activeFolderId
      }).forEach(({ message, threadGroupId, folderIds }) => {
        // When thread mode is disabled, keep sender-style display (no collapsed-thread participant substitution).
        const fromDisplay = getMessageFromDisplay(message.from, message.to, userEmail, false);
        items.push({
          type: "row",
          key: message.id,
          groupKey: group.key,
          isFirstInGroup: isFirstRow,
          message,
          depth: 0,
          threadGroupId,
          threadSize: 1,
          isCollapsed: false,
          isPinnedGroup: false,
          threadIndex: 0,
          fullFlat: [{ message, depth: 0 }],
          folderIds,
          fromText: fromDisplay.text,
          fromTooltip: fromDisplay.tooltip
        });
        if (isFirstRow) isFirstRow = false;
      });
    });
    return items;
  }, [
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
    userEmail
  ]);

  const { offsets, totalHeight } = useMemo(() => {
    const nextOffsets: number[] = [];
    let total = 0;
    listItems.forEach((item) => {
      nextOffsets.push(total);
      total += item.type === "group" ? groupHeight : rowHeight;
    });
    return { offsets: nextOffsets, totalHeight: total };
  }, [groupHeight, rowHeight, listItems]);

  const viewportHeight = scrollState.height || 720;
  const viewportTop = Math.max(0, scrollState.scrollTop);
  const startIndex =
    listItems.length === 0
      ? 0
      : Math.max(0, findStartIndex(offsets, viewportTop) - OVERSCAN_COUNT);
  const endIndex =
    listItems.length === 0
      ? -1
      : Math.min(
          listItems.length - 1,
          findStartIndex(offsets, viewportTop + viewportHeight) + OVERSCAN_COUNT
        );
  const visibleItems =
    startIndex <= endIndex ? listItems.slice(startIndex, endIndex + 1) : [];
  const lastToggle = lastGroupToggleRef.current;
  const now = Date.now();

  return (
    <div
      ref={listRef}
      className={styles.virtualList}
      style={{ height: totalHeight }}
    >
      {visibleItems.map((item, offsetIndex) => {
        const index = startIndex + offsetIndex;
        const top = offsets[index] ?? 0;
        if (item.type === "group") {
          const group = item.group;
          const isPinned = group.key === "Pinned";
          const isCollapsed = collapsedGroups[group.key];
          const count =
            group.items.length === 0 ? 0 : group.count ?? group.items.length;
          const isEmpty = group.items.length === 0;
          return (
            <Collapsible.Root
              key={`group-${group.key}`}
              className={styles.virtualItem}
              style={{ transform: `translateY(${top}px)`, height: groupHeight }}
              open={!isCollapsed}
              onOpenChange={(open) => {
                if (isEmpty) return;
                lastGroupToggleRef.current = { key: group.key, open, at: Date.now() };
                setCollapsedGroups((prev) => ({
                  ...prev,
                  [group.key]: !open
                }));
              }}
            >
              <Collapsible.Trigger asChild disabled={isEmpty}>
                <button
                  type="button"
                  className={`${styles.groupTitle} ${styles.groupToggle} ${
                    isPinned ? styles.groupTitlePinned : ""
                  }`}
                >
                  <span className={styles.groupCaret}>
                    {isEmpty ? "" : <CaretRightIcon />}
                  </span>
                  <Text as="span" size="1">
                    {getGroupLabel(group)} · {count}
                  </Text>
                </button>
              </Collapsible.Trigger>
            </Collapsible.Root>
          );
        }

        const message = item.message;
        const isSelected = selectedMessageIds.has(message.id);
        const isDragging = draggingMessageIds.has(message.id);
        const shouldAnimateRow =
          lastToggle?.open &&
          lastToggle.key === item.groupKey &&
          now - lastToggle.at < 220;
        const folderBadgeKey = item.folderIds.length ? item.folderIds.join("|") : "";
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
        const showCompactDivider =
          isCompactView && index > 0 && !item.isFirstInGroup;

        return (
          <div
            key={`row-${item.key}`}
            className={`${styles.virtualItem} ${shouldAnimateRow ? styles.rowEnter : ""}`}
            style={{ transform: `translateY(${top}px)`, height: rowHeight }}
          >
            <MessageRow
              message={message}
              isCompactView={isCompactView}
              listIsNarrow={listIsNarrow}
              isActive={message.id === activeMessageId}
              isThreadChild={item.depth > 0}
              isThreadSibling={
                activeThreadKey === item.threadGroupId &&
                message.id !== activeMessage?.id
              }
              isSelected={isSelected}
              isDragging={isDragging}
              isDisabled={pendingMessageActions.has(message.id)}
              showCollapsedActive={showCollapsedActive}
              paddingLeft={14 + item.depth * 10}
              showThreadCaret={item.threadIndex === 0 && item.threadSize > 1}
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
                if (
                  supportsThreads &&
                  item.threadSize > 1 &&
                  item.depth === 0 &&
                  item.threadIndex === 0 &&
                  item.isCollapsed
                ) {
                  if (item.isPinnedGroup) {
                    const pinnedTarget =
                      item.fullFlat.find((entry) =>
                        isPinnedMessage(entry.message)
                      )?.message ?? item.fullFlat[0].message;
                    selectCollapsedThread(item.fullFlat, pinnedTarget);
                  } else {
                    const latestTarget = item.fullFlat.reduce(
                      (acc, entry) =>
                        entry.message.dateValue > acc.message.dateValue
                          ? entry
                          : acc,
                      item.fullFlat[0]
                    ).message;
                    selectCollapsedThread(item.fullFlat, latestTarget);
                  }
                  return;
                }
                handleRowClick(event, message);
              }}
              onRowKeyDown={(event) => {
                if (event.key === " ") {
                  event.preventDefault();
                  if (event.shiftKey) {
                    selectRangeTo(message.id);
                  } else {
                    toggleMessageSelection(message.id);
                  }
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSelectMessage(message);
                }
              }}
              onDragStart={(event) => handleMessageDragStart(event, message)}
              onDragEnd={handleMessageDragEnd}
              onCheckboxChange={(shiftKey) => {
                if (shiftKey) {
                  selectRangeTo(message.id);
                } else {
                  toggleMessageSelection(message.id);
                }
              }}
              onSubjectClick={(event) => {
                event.stopPropagation();
                if (
                  supportsThreads &&
                  item.threadSize > 1 &&
                  item.depth === 0 &&
                  item.threadIndex === 0 &&
                  item.isCollapsed
                ) {
                  if (item.isPinnedGroup) {
                    const pinnedTarget =
                      item.fullFlat.find((entry) =>
                        isPinnedMessage(entry.message)
                      )?.message ?? item.fullFlat[0].message;
                    selectCollapsedThread(item.fullFlat, pinnedTarget);
                  } else {
                    const latestTarget = item.fullFlat.reduce(
                      (acc, entry) =>
                        entry.message.dateValue > acc.message.dateValue
                          ? entry
                          : acc,
                      item.fullFlat[0]
                    ).message;
                    selectCollapsedThread(item.fullFlat, latestTarget);
                  }
                } else {
                  handleSelectMessage(message);
                }
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
              renderUnreadDot={renderUnreadDot(message)}
              renderSelectIndicators={renderSelectIndicators(message)}
              fromText={item.fromText}
              fromTooltip={item.fromTooltip}
              folderBadges={renderFolderBadges(item.folderIds)}
              folderBadgeKey={folderBadgeKey}
              showFolderBadgesInSubjectMeta
              showFolderBadgesInMeta={false}
              quickActions={renderQuickActions(message)}
              messageMenu={renderMessageMenu(message, isCompactView ? "table" : "list")}
              showAttachmentIcon={
                message.hasAttachments ??
                (message.attachments?.some((att) => !att.inline) ?? false)
              }
              showCalendarInviteIcon={hasMessageFlag(message.flags, CALENDAR_INVITE_FLAG)}
              showNewBadge={
                !Boolean(message.seen) &&
                Boolean(message.recent) &&
                !Boolean(message.draft)
              }
            />
          </div>
        );
      })}
    </div>
  );

}
