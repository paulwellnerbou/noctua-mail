import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { GitBranch, Trash2 } from "lucide-react";
import { Badge, Checkbox, IconButton, Text } from "@radix-ui/themes";
import * as Collapsible from "@radix-ui/react-collapsible";
import { CaretRightIcon } from "@radix-ui/react-icons";
import { badgeColors } from "@/lib/ui/badgeColors";
import type { Message } from "@/lib/data";
import badgeStyles from "../message/MessageBadge.module.css";
import { buildFlatEntries, buildThreadGroupEntries } from "./threadGroupUtils";
import { useSelectionSnapshot, type SelectionStore } from "./selectionStore";
import groupStyles from "./MessageCardList.module.css";
import styles from "./MessageTable.module.css";

type SortKey = "date" | "from" | "subject";

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
  message: Message;
  depth: number;
  threadGroupId: string;
  threadSize: number;
  isCollapsed: boolean;
  isPinnedGroup: boolean;
  threadIndex: number;
  fullFlat: Array<{ message: Message; depth: number }>;
  folderIds: string[];
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

type MessageTableProps = {
  state: {
    groupedMessages: MessageGroup[];
    visibleMessages: Array<{ message: Message }>;
    selectionStore: SelectionStore;
    draggingMessageIds: Set<string>;
    collapsedGroups: Record<string, boolean>;
    collapsedThreads: Record<string, boolean>;
    pendingMessageActions: Set<string>;
    supportsThreads: boolean;
    includeThreadAcrossFolders: boolean;
    searchScope: "folder" | "all";
    activeFolderId: string;
    messageById: Map<string, Message>;
    sortDir: "asc" | "desc";
  };
  refs: {
    scrollRef: React.RefObject<HTMLDivElement | null>;
  };
  actions: {
    setSortKey: React.Dispatch<React.SetStateAction<SortKey>>;
    setSortDir: React.Dispatch<React.SetStateAction<"asc" | "desc">>;
    setCollapsedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    setCollapsedThreads: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    setLastSelectedIdRef: (id: string | null) => void;
    handleMessageDragStart: (event: React.DragEvent, message: Message) => void;
    handleMessageDragEnd: () => void;
    handleRowClick: (event: React.MouseEvent, message: Message) => void;
    handleSelectMessage: (message: Message) => void;
    toggleMessageSelection: (messageId: string, replace?: boolean) => void;
    selectRangeTo: (messageId: string) => void;
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
    isPinnedMessage: (message: Message) => boolean;
    isTrashFolder: (folderId?: string) => boolean;
    renderMessageMenu: (
      message: Message,
      view: "table" | "list",
      onOpenChange?: (open: boolean) => void
    ) => React.ReactNode;
  };
};

export default function MessageTable({
  state,
  actions,
  helpers,
  refs
}: MessageTableProps) {
  const {
    groupedMessages,
    visibleMessages,
    selectionStore,
    draggingMessageIds,
    collapsedGroups,
    collapsedThreads,
    pendingMessageActions,
    supportsThreads,
    includeThreadAcrossFolders,
    searchScope,
    activeFolderId,
    messageById,
    sortDir
  } = state;
  const { scrollRef } = refs;
  const {
    setSortKey,
    setSortDir,
    setCollapsedGroups,
    setCollapsedThreads,
    setLastSelectedIdRef,
    handleMessageDragStart,
    handleMessageDragEnd,
    handleRowClick,
    handleSelectMessage,
    toggleMessageSelection,
    selectRangeTo,
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
    isPinnedMessage,
    isTrashFolder,
    renderMessageMenu
  } = helpers;

  const { ids: selectedMessageIds, activeId: activeMessageId } =
    useSelectionSnapshot(selectionStore);
  const activeMessage = activeMessageId ? messageById.get(activeMessageId) ?? null : null;

  const [optimisticRow, setOptimisticRow] = useState<{
    id: string;
    selected: boolean;
    active: boolean;
  } | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!optimisticRow) return;
    const matchesSelected = selectedMessageIds.has(optimisticRow.id) === optimisticRow.selected;
    const matchesActive = !optimisticRow.active || activeMessageId === optimisticRow.id;
    if (matchesSelected && matchesActive) {
      setOptimisticRow(null);
    }
  }, [activeMessageId, optimisticRow, selectedMessageIds]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  const scheduleClear = () => {
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
    }
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      setOptimisticRow(null);
    }, 350);
  };



  const listRef = useRef<HTMLDivElement | null>(null);
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

  const rowHeight = 44;
  const groupHeight = 32;
  const lastGroupToggleRef = useRef<{ key: string; open: boolean; at: number } | null>(null);
  const activeThreadKey =
    activeMessage?.threadId ?? activeMessage?.messageId ?? activeMessage?.id;

  const listItems = useMemo(() => {
    const items: ListItem[] = [];
    groupedMessages.forEach((group) => {
      items.push({ type: "group", key: group.key, group });
      if (group.items.length === 0 || collapsedGroups[group.key]) return;

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
            items.push({
              type: "row",
              key: message.id,
              groupKey: group.key,
              message,
              depth,
              threadGroupId,
              threadSize,
              isCollapsed,
              isPinnedGroup: group.key === "Pinned",
              threadIndex: index,
              fullFlat,
              folderIds
            });
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
        items.push({
          type: "row",
          key: message.id,
          groupKey: group.key,
          message,
          depth: 0,
          threadGroupId,
          threadSize: 1,
          isCollapsed: false,
          isPinnedGroup: false,
          threadIndex: 0,
          fullFlat: [{ message, depth: 0 }],
          folderIds
        });
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
    getThreadLatestDate
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
    <div className={styles.table}>
      <div className={`${styles.row} ${styles.rowHeader}`}>
        <div className={styles.cellSelect} aria-hidden="true">
          <Checkbox
            size="1"
            checked={
              visibleMessages.length > 0 &&
              visibleMessages.every((item) => selectedMessageIds.has(item.message.id))
            }
            aria-label="Select all"
            onClick={(event) => {
              event.stopPropagation();
              const allIds = visibleMessages.map((item) => item.message.id);
              if (allIds.every((id) => selectedMessageIds.has(id))) {
                selectionStore.clearSelection();
              } else {
                selectionStore.setSelection(new Set(allIds));
                setLastSelectedIdRef(allIds[allIds.length - 1] ?? null);
              }
            }}
          />
        </div>
        <div className={styles.cellFrom}>
          <button
            className={styles.sortButton}
            onClick={() => {
              setSortKey("from");
              setSortDir(sortDir === "asc" ? "desc" : "asc");
            }}
          >
            From
          </button>
        </div>
        <div className={styles.cellSubject}>
          <button
            className={styles.sortButton}
            onClick={() => {
              setSortKey("subject");
              setSortDir(sortDir === "asc" ? "desc" : "asc");
            }}
          >
            Subject
          </button>
        </div>
        <div className={styles.cellDate}>
          <button
            className={styles.sortButton}
            onClick={() => {
              setSortKey("date");
              setSortDir(sortDir === "asc" ? "desc" : "asc");
            }}
          >
            Date
          </button>
        </div>
        <div className={styles.cellActions} aria-hidden="true" />
      </div>
      <div
        ref={listRef}
        className={styles.virtualList}
        style={{ height: totalHeight }}
      >
        {visibleItems.map((item, offsetIndex) => {
          const index = startIndex + offsetIndex;
          const top = offsets[index] ?? 0;
          const lastToggle = lastGroupToggleRef.current;
          const now = Date.now();
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
          const optimistic =
            optimisticRow && optimisticRow.id === message.id
              ? optimisticRow
              : null;
          const effectiveSelected = optimistic ? optimistic.selected : isSelected;
          const effectiveActive =
            message.id === activeMessageId || Boolean(optimistic?.active);
          const isDisabled = pendingMessageActions.has(message.id);
          const rowClassName = [
            styles.row,
            effectiveActive ? styles.rowActive : "",
            item.depth > 0 ? styles.threadChild : "",
            activeThreadKey === item.threadGroupId &&
            message.id !== activeMessage?.id
              ? styles.threadSibling
              : "",
            !message.seen ? styles.rowUnread : "",
            effectiveSelected ? styles.rowSelected : "",
            isDragging ? styles.rowDragging : "",
            isDisabled ? styles.rowDisabled : ""
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div
              key={`row-${item.key}`}
              className={`${styles.virtualItem} ${rowClassName} ${
                shouldAnimateRow ? styles.rowEnter : ""
              }`}
              style={{ transform: `translateY(${top}px)`, height: rowHeight }}
              role="button"
              tabIndex={0}
              draggable
              onDragStart={(event) => handleMessageDragStart(event, message)}
              onDragEnd={handleMessageDragEnd}
              onPointerDown={(event) => {
                if (isDisabled) return;
                if (event.button !== 0) return;
                const target = event.target as HTMLElement | null;
                const isCheckbox = Boolean(target?.closest('[role="checkbox"]'));
                const isInteractive = Boolean(
                  target?.closest("button, a, input, select, textarea")
                );
                if (isInteractive && !isCheckbox) return;
                const isToggle = event.metaKey || event.ctrlKey;
                const isRange = event.shiftKey;
                setOptimisticRow({
                  id: message.id,
                  selected: isCheckbox || isToggle ? !isSelected : true,
                  active: !isCheckbox && !isToggle && !isRange
                });
                scheduleClear();
                if (!isCheckbox && !isToggle && !isRange) {
                  handleSelectMessage(message);
                }
              }}
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
              <span className={styles.cellSelect}>
                {renderUnreadDot(message)}
                {renderSelectIndicators(message)}
                <Checkbox
                  size="1"
                  checked={effectiveSelected}
                  aria-label="Select message"
                  disabled={isDisabled}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.shiftKey) {
                      selectRangeTo(message.id);
                    } else {
                      toggleMessageSelection(message.id);
                    }
                  }}
                />
              </span>
              <span
                className={styles.cellFrom}
                style={{ paddingLeft: `${item.depth * 14}px` }}
              >
                {item.threadIndex === 0 && item.threadSize > 1 ? (
                  <>
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
                    <Badge
                      size="1"
                      variant="soft"
                      color={badgeColors.threadIndicator}
                      className={`${badgeStyles.badge} ${styles.threadIndicatorInline}`}
                    >
                      <GitBranch size={12} />
                      <span>{item.threadSize}</span>
                    </Badge>
                  </>
                ) : (
                  <span className={`${styles.threadCaret} ${styles.threadCaretSpacer}`}>
                    <CaretRightIcon />
                  </span>
                )}
                {message.from}
              </span>
              <span
                className={styles.cellSubject}
                onClick={(event) => {
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
              >
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
          );
        })}
      </div>
    </div>
  );

}
