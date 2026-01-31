import { useEffect, useRef, useState } from "react";
import type React from "react";
import { GitBranch, Trash2 } from "lucide-react";
import { Badge, Checkbox, IconButton, Text } from "@radix-ui/themes";
import { badgeColors } from "@/lib/ui/badgeColors";
import type { Message } from "@/lib/data";
import badgeStyles from "../message/MessageBadge.module.css";
import { buildFlatEntries, buildThreadGroupEntries } from "./threadGroupUtils";
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

type MessageTableProps = {
  state: {
    groupedMessages: MessageGroup[];
    visibleMessages: Array<{ message: Message }>;
    selectedMessageIds: Set<string>;
    draggingMessageIds: Set<string>;
    collapsedGroups: Record<string, boolean>;
    collapsedThreads: Record<string, boolean>;
    pendingMessageActions: Set<string>;
    supportsThreads: boolean;
    includeThreadAcrossFolders: boolean;
    searchScope: "folder" | "all";
    activeFolderId: string;
    activeMessageId: string;
    activeMessage: Message | null;
    sortDir: "asc" | "desc";
  };
  actions: {
    clearSelection: () => void;
    setSelectedMessageIds: React.Dispatch<React.SetStateAction<Set<string>>>;
    setLastSelectedId: React.Dispatch<React.SetStateAction<string | null>>;
    setSortKey: React.Dispatch<React.SetStateAction<SortKey>>;
    setSortDir: React.Dispatch<React.SetStateAction<"asc" | "desc">>;
    setCollapsedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    setCollapsedThreads: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
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

export default function MessageTable({ state, actions, helpers }: MessageTableProps) {
  const {
    groupedMessages,
    visibleMessages,
    selectedMessageIds,
    draggingMessageIds,
    collapsedGroups,
    collapsedThreads,
    pendingMessageActions,
    supportsThreads,
    includeThreadAcrossFolders,
    searchScope,
    activeFolderId,
    activeMessageId,
    activeMessage,
    sortDir
  } = state;
  const {
    clearSelection,
    setSelectedMessageIds,
    setLastSelectedId,
    setSortKey,
    setSortDir,
    setCollapsedGroups,
    setCollapsedThreads,
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
                clearSelection();
              } else {
                setSelectedMessageIds(new Set(allIds));
                if (allIds.length > 0) {
                  setLastSelectedId(allIds[allIds.length - 1]);
                }
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
      {groupedMessages.map((group) => (
        <div key={group.key} className={groupStyles.group}>
          <div
            className={`${groupStyles.groupTitle} ${groupStyles.groupToggle} ${
              group.key === "Pinned" ? groupStyles.groupTitlePinned : ""
            }`}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (group.items.length === 0) return;
              setCollapsedGroups((prev) => ({
                ...prev,
                [group.key]: !prev[group.key]
              }));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                if (group.items.length === 0) return;
                setCollapsedGroups((prev) => ({
                  ...prev,
                  [group.key]: !prev[group.key]
                }));
              }
            }}
          >
            <span
              className={`${groupStyles.groupCaret} ${
                collapsedGroups[group.key] ? "" : groupStyles.groupCaretOpen
              }`}
            >
              {group.items.length === 0 ? "" : "▸"}
            </span>
            <Text as="span" size="1">
              {getGroupLabel(group)} ·{" "}
              {group.items.length === 0 ? 0 : group.count ?? group.items.length}
            </Text>
          </div>
          {group.items.length > 0 && !collapsedGroups[group.key] && (
            <>
              {supportsThreads
                ? buildThreadGroupEntries({
                    group,
                    collapsedThreads,
                    includeThreadAcrossFolders,
                    searchScope,
                    activeFolderId,
                    buildThreadTree,
                    flattenThread,
                    getThreadLatestDate
                  }).map((entry) => {
                    const isPinnedGroup = group.key === "Pinned";
                    const threadGroupId = entry.threadGroupId;
                    const activeThreadKey =
                      activeMessage?.threadId ??
                      activeMessage?.messageId ??
                      activeMessage?.id;
                    const fullFlat = entry.fullFlat;
                    const threadSize = entry.threadSize;
                    const isCollapsed = entry.isCollapsed;
                    const flat = entry.flat;
                    const threadFolderIds = entry.threadFolderIds;
                    const showThreadFolderBadges = entry.showThreadFolderBadges;
                    return (
                      <div key={`${threadGroupId}-${entry.root.message.id}`}>
                        {flat.map(({ message, depth }, index) => {
                          const isSelected = selectedMessageIds.has(message.id);
                          const isDragging = draggingMessageIds.has(message.id);
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
                            depth > 0 ? styles.threadChild : "",
                            activeThreadKey === threadGroupId &&
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
                              key={message.id}
                              className={rowClassName}
                              role="button"
                              tabIndex={0}
                              draggable
                              onDragStart={(event) => handleMessageDragStart(event, message)}
                              onDragEnd={handleMessageDragEnd}
                              onPointerDown={(event) => {
                                if (isDisabled) return;
                                if (event.button !== 0) return;
                                const target = event.target as HTMLElement | null;
                                const isCheckbox = Boolean(
                                  target?.closest('[role="checkbox"]')
                                );
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
                              }}
                              onClick={(event) => {
                                if (
                                  supportsThreads &&
                                  threadSize > 1 &&
                                    depth === 0 &&
                                    index === 0 &&
                                    isCollapsed
                                  ) {
                                    if (isPinnedGroup) {
                                      const pinnedTarget =
                                        fullFlat.find((item) =>
                                          isPinnedMessage(item.message)
                                        )?.message ?? fullFlat[0].message;
                                      selectCollapsedThread(fullFlat, pinnedTarget);
                                    } else {
                                      const latestTarget = fullFlat.reduce(
                                        (acc, item) =>
                                          item.message.dateValue > acc.message.dateValue
                                            ? item
                                            : acc,
                                        fullFlat[0]
                                      ).message;
                                      selectCollapsedThread(fullFlat, latestTarget);
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
                                  style={{ paddingLeft: `${depth * 14}px` }}
                                >
                                  {index === 0 && threadSize > 1 ? (
                                    <>
                                      <span
                                        className={`${styles.threadCaret} ${
                                          isCollapsed ? "" : styles.threadCaretOpen
                                        }`}
                                        title={isCollapsed ? "Expand thread" : "Collapse thread"}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setCollapsedThreads((prev) => ({
                                            ...prev,
                                            [threadGroupId]: !isCollapsed
                                          }));
                                        }}
                                      >
                                        ▸
                                      </span>
                                      <Badge
                                        size="1"
                                        variant="soft"
                                        color={badgeColors.threadIndicator}
                                        className={`${badgeStyles.badge} ${styles.threadIndicatorInline}`}
                                      >
                                        <GitBranch size={12} />
                                        <span>{threadSize}</span>
                                      </Badge>
                                    </>
                                  ) : (
                                    <span
                                      className={`${styles.threadCaret} ${styles.threadCaretSpacer}`}
                                    >
                                      ▸
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
                                      threadSize > 1 &&
                                      depth === 0 &&
                                      index === 0 &&
                                      isCollapsed
                                    ) {
                                      if (isPinnedGroup) {
                                        const pinnedTarget =
                                          fullFlat.find((item) =>
                                            isPinnedMessage(item.message)
                                          )?.message ?? fullFlat[0].message;
                                        selectCollapsedThread(fullFlat, pinnedTarget);
                                      } else {
                                        const latestTarget = fullFlat.reduce(
                                          (acc, item) =>
                                            item.message.dateValue > acc.message.dateValue
                                              ? item
                                              : acc,
                                          fullFlat[0]
                                        ).message;
                                        selectCollapsedThread(fullFlat, latestTarget);
                                      }
                                    } else {
                                      handleSelectMessage(message);
                                    }
                                  }}
                                >
                                  {renderFolderBadges(folderIds)}
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
                      );
                    })
                : buildFlatEntries({
                    group,
                    includeThreadAcrossFolders,
                    searchScope,
                    activeFolderId
                  }).map(({ message, threadGroupId, folderIds }) => {
                    const activeThreadKey =
                      activeMessage?.threadId ?? activeMessage?.messageId ?? activeMessage?.id;
                    const isSelected = selectedMessageIds.has(message.id);
                    const isDragging = draggingMessageIds.has(message.id);
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
                      activeThreadKey === threadGroupId &&
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
                        key={message.id}
                        className={rowClassName}
                        role="button"
                        tabIndex={0}
                        draggable
                        onDragStart={(event) => handleMessageDragStart(event, message)}
                        onDragEnd={handleMessageDragEnd}
                        onPointerDown={(event) => {
                          if (isDisabled) return;
                          if (event.button !== 0) return;
                          const target = event.target as HTMLElement | null;
                          const isCheckbox = Boolean(
                            target?.closest('[role="checkbox"]')
                          );
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
                        }}
                        onClick={(event) => handleRowClick(event, message)}
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
                        <span className={styles.cellFrom}>{message.from}</span>
                        <span className={styles.cellSubject}>
                          {renderFolderBadges(folderIds)}
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
            </>
          )}
        </div>
      ))}
    </div>
  );
}
