import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { CalendarDays, GitBranch, MoveRight, Paperclip, Trash2 } from "lucide-react";
import { Badge, IconButton, Text } from "@radix-ui/themes";
import { CaretRightIcon } from "@radix-ui/react-icons";
import * as Collapsible from "@radix-ui/react-collapsible";
import { badgeColors } from "@/lib/ui/badgeColors";
import type { Message } from "@/lib/data";
import { CALENDAR_INVITE_FLAG, hasMessageFlag } from "@/lib/messageFlags";
import badgeStyles from "../message/MessageBadge.module.css";
import {
  buildVisibleThreadRows,
  buildFlatEntries,
  buildThreadGroupEntries,
  getDisplaySeenForThreadRow,
  getThreadMessagesForThreadRow,
  getCollapsedThreadFromDisplay,
  getMessageFromDisplay,
  isCollapsedThreadRootRow
} from "./threadGroupUtils";
import { getMessageListDateDisplay } from "./messageDateDisplay";
import { useSelectionSnapshot, type SelectionStore } from "./selectionStore";
import ThreadMarkers from "./ThreadMarkers";
import groupStyles from "./MessageCardList.module.css";
import styles from "./MessageThreadList.module.css";

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
    handleDeleteMessage
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

  const listRef = useRef<HTMLDivElement | null>(null);
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
  const [scrollState, setScrollState] = useState({ scrollTop: 0, height: 0 });
  const [animationClock, setAnimationClock] = useState(0);
  const [collapsedNestedMessages, setCollapsedNestedMessages] = useState<Record<string, boolean>>({});

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
          const visibleRows = buildVisibleThreadRows({
            flat,
            collapsedNestedMessages
          });

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
                const at = Date.now();
                setLastGroupToggle({ key: group.key, open, at });
                setAnimationClock(at);
                setCollapsedGroups((prev) => ({
                  ...prev,
                  [group.key]: !open
                }));
              }}
            >
              <Collapsible.Trigger asChild disabled={isEmpty}>
                <button
                  type="button"
                  className={`${groupStyles.groupTitle} ${groupStyles.groupToggle} ${
                    isPinned ? groupStyles.groupTitlePinned : ""
                  }`}
                >
                  <span className={groupStyles.groupCaret}>
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
        const dateDisplay = getMessageListDateDisplay(message.dateValue, message.date);
        const isSelected = selectedMessageIds.has(message.id);
        const isDragging = draggingMessageIds.has(message.id);

        // Check if row should animate due to group, thread, or nested message expansion
        const animateFromGroup =
          animationClock > 0 &&
          lastGroupToggle?.open &&
          lastGroupToggle.key === item.groupKey &&
          animationClock - lastGroupToggle.at < 220;

        const animateFromThread =
          animationClock > 0 &&
          lastThreadToggle?.open &&
          lastThreadToggle.key === item.threadGroupId &&
          item.depth > 0 &&
          animationClock - lastThreadToggle.at < 220;

        const animateFromNested = (() => {
          if (!animationClock || !lastNestedToggle?.open || item.depth === 0) return false;
          if (animationClock - lastNestedToggle.at >= 220) return false;

          const expandedId = lastNestedToggle.key;
          const flatIndex = item.fullFlat.findIndex(e => e.message.id === message.id);
          const expandedIndex = item.fullFlat.findIndex(e => e.message.id === expandedId);
          if (expandedIndex === -1 || flatIndex <= expandedIndex) return false;

          const expandedDepth = item.fullFlat[expandedIndex].depth;
          if (item.depth <= expandedDepth) return false;

          // Check if expanded message is an ancestor (no message at <= expandedDepth between them)
          for (let i = expandedIndex + 1; i < flatIndex; i++) {
            if (item.fullFlat[i].depth <= expandedDepth) {
              return false;
            }
          }
          return true;
        })();

        const shouldAnimateRow = animateFromGroup || animateFromThread || animateFromNested;
        const isActive = message.id === activeMessageId;
        const isDisabled = pendingMessageActions.has(message.id);
        const showRowDivider = index > 0 && !item.isFirstInGroup;
        const isActiveThread =
          Boolean(activeMessageId) &&
          item.fullFlat.some((entry) => entry.message.id === activeMessageId);
        const showCollapsedActive =
          item.isCollapsed &&
          item.threadIndex === 0 &&
          item.depth === 0 &&
          item.threadSize > 1 &&
          isActiveThread;
        const isCollapsedThreadRoot = isCollapsedThreadRootRow({
          isCollapsed: item.isCollapsed,
          threadSize: item.threadSize,
          depth: item.depth,
          threadIndex: item.threadIndex
        });
        const displaySeen = getDisplaySeenForThreadRow({
          messageSeen: Boolean(message.seen),
          messageId: message.id,
          isCollapsed: item.isCollapsed,
          threadSize: item.threadSize,
          depth: item.depth,
          threadIndex: item.threadIndex,
          isNestedCollapsed: item.isNestedCollapsed,
          fullFlat: item.fullFlat
        });
        const threadMessages = getThreadMessagesForThreadRow({
          message,
          messageId: message.id,
          isCollapsed: item.isCollapsed,
          threadSize: item.threadSize,
          depth: item.depth,
          threadIndex: item.threadIndex,
          isNestedCollapsed: item.isNestedCollapsed,
          fullFlat: item.fullFlat
        });

        const rowContainerClassName = [
          styles.messageRowContainer,
          showRowDivider ? styles.rowDivider : "",
          isActive || showCollapsedActive ? styles.rowActive : "",
          !showCollapsedActive &&
          activeThreadKey === item.threadGroupId &&
          message.id !== activeMessage?.id
            ? styles.threadSibling
            : "",
          !displaySeen ? styles.rowUnread : "",
          isSelected ? styles.rowSelected : "",
          isDragging ? styles.rowDragging : "",
          isDisabled ? styles.rowDisabled : ""
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <div
            key={`row-${item.key}`}
            className={`${styles.virtualItem} ${shouldAnimateRow ? styles.rowEnter : ""}`}
            style={{ transform: `translateY(${top}px)`, height: rowHeight }}
          >
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
                  const threadIds =
                    isCollapsedThreadRoot
                      ? item.fullFlat.map((entry) => entry.message.id)
                      : undefined;
                  handleMessageDragStart(event, message, threadIds);
                }}
                onDragEnd={handleMessageDragEnd}
                onClick={(event) => {
                  const hasSelectionModifier = event.shiftKey || event.metaKey || event.ctrlKey;
                  if (
                    !hasSelectionModifier &&
                    supportsThreads &&
                    isCollapsedThreadRoot
                  ) {
                    selectCollapsedThread(item.fullFlat, message);
                    return;
                  }
                  handleRowClick(event, message);
                }}
                onKeyDown={(event) => {
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
                  {(message.hasAttachments ??
                    (message.attachments?.some((att) => !att.inline) ?? false)) && (
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
                  {hasMessageFlag(message.flags, CALENDAR_INVITE_FLAG) && (
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
          </div>
        );
      })}
    </div>
  );
}
