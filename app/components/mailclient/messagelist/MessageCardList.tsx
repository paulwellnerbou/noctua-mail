import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import type { Message } from "@/lib/data";
import { CALENDAR_INVITE_FLAG, hasMessageFlag, isCalendarAttachment } from "@/lib/messageFlags";
import { Text } from "@radix-ui/themes";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CaretRightIcon } from "@radix-ui/react-icons";
import MessageRow from "./MessageRow";
import {
  buildVisibleThreadRows,
  buildFlatEntries,
  buildThreadGroupEntries,
  getDisplaySeenForThreadRow,
  getCollapsedThreadFromDisplay,
  getMessageFromDisplay,
  isCollapsedThreadRootRow
} from "./threadGroupUtils";
import { useSelectionSnapshot, type SelectionStore } from "./selectionStore";
import ThreadMarkers from "./ThreadMarkers";
import styles from "./MessageCardList.module.css";
import threadRowStyles from "./MessageThreadList.module.css";

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
  showRecipientIcon: boolean;
  isLastInDepth: boolean;
  hasChildren: boolean;
  isNestedCollapsed: boolean;
  ancestorStopsHere: boolean[];
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
    isTrashFolder
  } = helpers;


  const listRef = useRef<HTMLDivElement | null>(null);
  const lastGroupToggleRef = useRef<{ key: string; open: boolean; at: number } | null>(null);
  const lastThreadToggleRef = useRef<{ key: string; open: boolean; at: number } | null>(null);
  const lastNestedToggleRef = useRef<{ key: string; open: boolean; at: number } | null>(null);
  const [scrollState, setScrollState] = useState({ scrollTop: 0, height: 0 });
  const [collapsedNestedMessages, setCollapsedNestedMessages] = useState<Record<string, boolean>>(
    {}
  );

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

  const rowHeight = isCompactView ? 60 : 100;
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
            isCollapsed && threadSize > 1
              ? getCollapsedThreadFromDisplay(fullFlat, userEmail, preferToDisplay)
              : null;
          const visibleRows = isCompactView
            ? buildVisibleThreadRows({
                flat,
                collapsedNestedMessages
              })
            : flat.map(({ message, depth }) => ({
                message,
                depth,
                isLastInDepth: true,
                hasChildren: false,
                isNestedCollapsed: false,
                ancestorStopsHere: []
              }));
          visibleRows.forEach((row, index) => {
            const {
              message,
              depth,
              isLastInDepth,
              hasChildren,
              isNestedCollapsed,
              ancestorStopsHere
            } = row;
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
                : getMessageFromDisplay(
                    message.from,
                    { to: message.to, cc: message.cc, bcc: message.bcc },
                    userEmail,
                    isInExpandedThread,
                    preferToDisplay
                  );
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
              fromTooltip: fromDisplay.tooltip,
              showRecipientIcon: Boolean(fromDisplay.showRecipientIcon),
              isLastInDepth,
              hasChildren,
              isNestedCollapsed,
              ancestorStopsHere
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
        const fromDisplay = getMessageFromDisplay(
          message.from,
          { to: message.to, cc: message.cc, bcc: message.bcc },
          userEmail,
          false,
          preferToDisplay
        );
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
          fromTooltip: fromDisplay.tooltip,
          showRecipientIcon: Boolean(fromDisplay.showRecipientIcon),
          isLastInDepth: true,
          hasChildren: false,
          isNestedCollapsed: false,
          ancestorStopsHere: []
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
    userEmail,
    preferToDisplay,
    isCompactView,
    collapsedNestedMessages
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
  const lastGroupToggle = lastGroupToggleRef.current;
  const lastThreadToggle = lastThreadToggleRef.current;
  const lastNestedToggle = lastNestedToggleRef.current;
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
        const isActive = message.id === activeMessageId;
        const isThreadSibling =
          activeThreadKey === item.threadGroupId &&
          message.id !== activeMessage?.id;
        const isSelected = selectedMessageIds.has(message.id);
        const isDragging = draggingMessageIds.has(message.id);
        const animateFromGroup =
          lastGroupToggle?.open &&
          lastGroupToggle.key === item.groupKey &&
          now - lastGroupToggle.at < 220;
        const animateFromThread =
          isCompactView &&
          lastThreadToggle?.open &&
          lastThreadToggle.key === item.threadGroupId &&
          item.depth > 0 &&
          now - lastThreadToggle.at < 220;
        const animateFromNested = (() => {
          if (!isCompactView || !lastNestedToggle?.open || item.depth === 0) return false;
          if (now - lastNestedToggle.at >= 220) return false;
          const expandedId = lastNestedToggle.key;
          const flatIndex = item.fullFlat.findIndex((entry) => entry.message.id === message.id);
          const expandedIndex = item.fullFlat.findIndex(
            (entry) => entry.message.id === expandedId
          );
          if (expandedIndex === -1 || flatIndex <= expandedIndex) return false;
          const expandedDepth = item.fullFlat[expandedIndex].depth;
          if (item.depth <= expandedDepth) return false;
          for (let i = expandedIndex + 1; i < flatIndex; i++) {
            if (item.fullFlat[i].depth <= expandedDepth) {
              return false;
            }
          }
          return true;
        })();
        const shouldAnimateRow = animateFromGroup || animateFromThread || animateFromNested;
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
        const displaySeen = getDisplaySeenForThreadRow({
          messageSeen: Boolean(message.seen),
          isCollapsed: item.isCollapsed,
          threadSize: item.threadSize,
          depth: item.depth,
          threadIndex: item.threadIndex,
          fullFlat: item.fullFlat
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
          useCompactThreadContainer && (isActive || showCollapsedActive)
            ? threadRowStyles.rowActive
            : "",
          useCompactThreadContainer && !showCollapsedActive && isThreadSibling
            ? threadRowStyles.threadSibling
            : "",
          useCompactThreadContainer && !displaySeen ? threadRowStyles.rowUnread : "",
          useCompactThreadContainer && isSelected ? threadRowStyles.rowSelected : "",
          useCompactThreadContainer && isDragging ? threadRowStyles.rowDragging : "",
          useCompactThreadContainer && pendingMessageActions.has(message.id)
            ? threadRowStyles.rowDisabled
            : ""
        ]
          .filter(Boolean)
          .join(" ");
        const isCollapsedThreadRoot = isCollapsedThreadRootRow({
          isCollapsed: item.isCollapsed,
          threadSize: item.threadSize,
          depth: item.depth,
          threadIndex: item.threadIndex
        });
        const threadMessages = isCollapsedThreadRoot
          ? item.fullFlat.map((entry) => entry.message)
          : [message];

        return (
          <div
            key={`row-${item.key}`}
            className={`${styles.virtualItem} ${shouldAnimateRow ? styles.rowEnter : ""}`}
            style={{ transform: `translateY(${top}px)`, height: rowHeight }}
          >
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
                    lastThreadToggleRef.current = {
                      key: item.threadGroupId,
                      open: willOpen,
                      at: Date.now()
                    };
                    setCollapsedThreads((prev) => ({
                      ...prev,
                      [item.threadGroupId]: !item.isCollapsed
                    }));
                  }}
                  onToggleNested={() => {
                    const willOpen = item.isNestedCollapsed;
                    lastNestedToggleRef.current = {
                      key: message.id,
                      open: willOpen,
                      at: Date.now()
                    };
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
                isActive={isActive}
                isThreadChild={item.depth > 0}
                isThreadSibling={isThreadSibling}
                isSelected={isSelected}
                isDragging={isDragging}
                isDisabled={pendingMessageActions.has(message.id)}
                showCollapsedActive={showCollapsedActive}
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
                  if (supportsThreads && isCollapsedThreadRoot) {
                    selectCollapsedThread(item.fullFlat, message);
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
                onDragStart={(event) => {
                  const threadIds =
                    isCollapsedThreadRoot
                      ? item.fullFlat.map((entry) => entry.message.id)
                      : undefined;
                  handleMessageDragStart(event, message, threadIds);
                }}
                onDragEnd={handleMessageDragEnd}
                onCheckboxChange={(shiftKey) => {
                  if (shiftKey) {
                    selectRangeTo(message.id);
                  } else {
                    toggleMessageSelection(message.id, false, false);
                  }
                }}
                onSubjectClick={(event) => {
                  event.stopPropagation();
                  if (supportsThreads && isCollapsedThreadRoot) {
                    selectCollapsedThread(item.fullFlat, message);
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
                showAttachmentIcon={(() => {
                  const nonInlineAttachments =
                    message.attachments?.filter((att) => !att.inline) ?? [];
                  if (nonInlineAttachments.length === 0) return false;
                  // Don't show attachment icon if all non-inline attachments are calendar events
                  const allCalendar = nonInlineAttachments.every(isCalendarAttachment);
                  return !allCalendar;
                })()}
                showCalendarInviteIcon={hasMessageFlag(message.flags, CALENDAR_INVITE_FLAG)}
                showNewBadge={
                  !displaySeen &&
                  Boolean(message.recent) &&
                  !Boolean(message.draft)
                }
              />
            </div>
          </div>
        );
      })}
    </div>
  );

}
