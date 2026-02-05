import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { GitBranch, Trash2 } from "lucide-react";
import { Badge, IconButton, Text } from "@radix-ui/themes";
import { CaretRightIcon } from "@radix-ui/react-icons";
import * as Collapsible from "@radix-ui/react-collapsible";
import { badgeColors } from "@/lib/ui/badgeColors";
import type { Message } from "@/lib/data";
import badgeStyles from "../message/MessageBadge.module.css";
import {
  buildFlatEntries,
  buildThreadGroupEntries,
  getCollapsedThreadFromDisplay,
  getMessageFromDisplay
} from "./threadGroupUtils";
import { useSelectionSnapshot, type SelectionStore } from "./selectionStore";
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
    renderFolderBadges: (folderIds: string[]) => React.ReactNode;
    handleShowRelated: (message: Message) => void;
    isPinnedMessage: (message: Message) => boolean;
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
    renderFolderBadges,
    handleShowRelated,
    isPinnedMessage,
    isTrashFolder,
    renderMessageMenu
  } = helpers;

  const listRef = useRef<HTMLDivElement | null>(null);
  const lastGroupToggleRef = useRef<{ key: string; open: boolean; at: number } | null>(null);
  const [scrollState, setScrollState] = useState({ scrollTop: 0, height: 0 });
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
            isCollapsed && threadSize > 1 ? getCollapsedThreadFromDisplay(fullFlat, userEmail) : null;

          // Build a map of children for each message
          const childrenMap = new Map<string, Set<string>>();
          flat.forEach(({ message, depth }, index) => {
            if (index === 0) return;
            // Find parent (previous message with lower depth)
            for (let i = index - 1; i >= 0; i--) {
              if (flat[i].depth < depth) {
                const parentId = flat[i].message.id;
                if (!childrenMap.has(parentId)) {
                  childrenMap.set(parentId, new Set());
                }
                childrenMap.get(parentId)!.add(message.id);
                break;
              }
            }
          });

          // Filter out children of collapsed messages
          const visibleFlat = flat.filter(({ message }, index) => {
            if (index === 0) return true;
            // Check if any ancestor is collapsed
            for (let i = index - 1; i >= 0; i--) {
              const ancestor = flat[i];
              if (ancestor.depth < flat[index].depth) {
                if (collapsedNestedMessages[ancestor.message.id]) {
                  return false;
                }
              }
            }
            return true;
          });

          // Determine which messages are the last child of their parent
          const isLastChildOfParent = new Map<number, boolean>();
          visibleFlat.forEach(({ message, depth }, index) => {
            if (depth === 0) {
              // For root messages, check if there's a next root message
              const hasNextRoot = visibleFlat.slice(index + 1).some(item => item.depth === 0);
              isLastChildOfParent.set(index, !hasNextRoot);
            } else {
              // Find the next sibling (same depth, same parent)
              let hasNextSibling = false;
              for (let i = index + 1; i < visibleFlat.length; i++) {
                if (visibleFlat[i].depth < depth) {
                  // Reached a shallower level, no more siblings
                  break;
                }
                if (visibleFlat[i].depth === depth) {
                  // Found a sibling
                  hasNextSibling = true;
                  break;
                }
              }
              isLastChildOfParent.set(index, !hasNextSibling);
            }
          });

          // Build ancestor paths and determine which ancestors stop vertical lines
          const ancestorStopsHere = new Map<number, boolean[]>();
          visibleFlat.forEach(({ message, depth }, index) => {
            const stops: boolean[] = [];

            // Build the ancestor path by walking backwards through visibleFlat
            const ancestors: number[] = [];
            for (let d = depth - 1; d >= 0; d--) {
              // Find the closest message before this one at depth d
              for (let i = index - 1; i >= 0; i--) {
                if (visibleFlat[i].depth === d) {
                  ancestors.unshift(i);
                  break;
                }
              }
            }

            // For each ancestor at depth d, check if it's the last child
            ancestors.forEach((ancestorIndex, d) => {
              stops[d] = isLastChildOfParent.get(ancestorIndex) ?? false;
            });

            ancestorStopsHere.set(index, stops);
          });

          visibleFlat.forEach(({ message, depth }, index) => {
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
                : getMessageFromDisplay(message.from, message.to, userEmail, isInExpandedThread);

            const isLastInDepth = isLastChildOfParent.get(index) ?? false;
            const hasChildren = childrenMap.has(message.id) && (childrenMap.get(message.id)?.size ?? 0) > 0;
            const isNestedCollapsed = collapsedNestedMessages[message.id] ?? false;
            const stops = ancestorStopsHere.get(index) ?? [];

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
              isLastInDepth,
              hasChildren,
              isNestedCollapsed,
              ancestorStopsHere: stops
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
        const fromDisplay = getMessageFromDisplay(message.from, message.to, userEmail, true);
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
        const isSelected = selectedMessageIds.has(message.id);
        const isDragging = draggingMessageIds.has(message.id);
        const shouldAnimateRow =
          lastToggle?.open &&
          lastToggle.key === item.groupKey &&
          now - lastToggle.at < 220;
        const isActive = message.id === activeMessageId;
        const isDisabled = pendingMessageActions.has(message.id);

        const rowClassName = [
          styles.row,
          isActive ? styles.rowActive : "",
          activeThreadKey === item.threadGroupId && message.id !== activeMessage?.id
            ? styles.threadSibling
            : "",
          !message.seen ? styles.rowUnread : "",
          isSelected ? styles.rowSelected : "",
          isDragging ? styles.rowDragging : "",
          isDisabled ? styles.rowDisabled : ""
        ]
          .filter(Boolean)
          .join(" ");

        // Render thread markers for nested messages
        const threadMarkers = [];

        // For root messages (depth 0) that are thread starters, add caret
        if (item.depth === 0 && item.threadIndex === 0 && item.threadSize > 1) {
          threadMarkers.push(
            <div key="root-caret" className={styles.rootCaretContainer}>
              <span
                className={`${styles.threadCaret} ${
                  item.isCollapsed ? "" : styles.threadCaretOpen
                }`}
                title={item.isCollapsed ? "Expand thread" : "Collapse thread"}
                onClick={(event) => {
                  event.stopPropagation();
                  setCollapsedThreads((prev) => ({
                    ...prev,
                    [item.threadGroupId]: !item.isCollapsed
                  }));
                }}
              >
                <CaretRightIcon />
              </span>
            </div>
          );
        }

        // For nested messages (depth > 0), add parent markers and connectors
        for (let d = 0; d < item.depth; d++) {
          const isLast = d === item.depth - 1;
          const shouldUseCorner = isLast && item.isLastInDepth;
          // Marker at position d should check if ancestor at depth d+1 is the last child
          const hideVerticalLine = !isLast && (item.ancestorStopsHere[d + 1] ?? false);

          if (isLast) {
            // Last marker shows the horizontal connector
            threadMarkers.push(
              <div
                key={`marker-${d}`}
                className={`${styles.threadMarkerWithCaret} ${
                  shouldUseCorner ? styles.threadMarkerLast : ""
                }`}
              />
            );
          } else {
            // Parent markers only show vertical lines
            threadMarkers.push(
              <div
                key={`marker-${d}`}
                className={`${styles.threadMarker} ${
                  hideVerticalLine ? styles.threadMarkerNoVertical : ""
                }`}
              />
            );
          }
        }

        // Add caret after markers for nested messages with children
        if (item.depth > 0 && item.hasChildren) {
          threadMarkers.push(
            <span
              key="nested-caret"
              className={`${styles.nestedThreadCaret} ${
                item.isNestedCollapsed ? "" : styles.nestedThreadCaretOpen
              }`}
              title={item.isNestedCollapsed ? "Expand" : "Collapse"}
              onClick={(event) => {
                event.stopPropagation();
                setCollapsedNestedMessages((prev) => ({
                  ...prev,
                  [message.id]: !item.isNestedCollapsed
                }));
              }}
            >
              <CaretRightIcon />
            </span>
          );
        }

        return (
          <div
            key={`row-${item.key}`}
            className={`${styles.virtualItem} ${shouldAnimateRow ? styles.rowEnter : ""}`}
            style={{ transform: `translateY(${top}px)`, height: rowHeight }}
          >
            <div className={styles.messageRowContainer}>
              {threadMarkers}
              <div
                className={rowClassName}
                role="button"
                tabIndex={0}
                draggable
                onDragStart={(event) => handleMessageDragStart(event, message)}
                onDragEnd={handleMessageDragEnd}
                onClick={(event) => {
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
                  {item.fromText}
                </span>

                <span className={styles.cellSubject}>
                  {renderFolderBadges(item.folderIds)}
                  <span className={styles.cellSubjectText}>{message.subject}</span>
                </span>

                <span className={styles.cellDate}>
                  <Text as="span" size="1">
                    {message.date}
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
