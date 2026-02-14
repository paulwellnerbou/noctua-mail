import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { GitBranch, MoveRight, Search, Trash2 } from "lucide-react";
import { Badge, Checkbox, IconButton, Text } from "@radix-ui/themes";
import { CaretRightIcon } from "@radix-ui/react-icons";
import { badgeColors } from "@/lib/ui/badgeColors";
import type { AccountDateFormat, Message } from "@/lib/data";
import badgeStyles from "../message/MessageBadge.module.css";
import {
  buildMessageListItems,
  type MessageGroup,
  type ThreadNode
} from "./listModel";
import { getMessageListDateDisplay } from "./messageDateDisplay";
import { useSelectionSnapshot, type SelectionStore } from "./selectionStore";
import MessageListRenderer from "./MessageListRenderer";
import {
  getDragThreadMessageIds,
  getThreadRowDisplayMeta,
  getThreadRowSelectionMeta,
  handleCollapsedThreadRootClick,
  handleMessageRowKeyDown,
  handleRowCheckboxChange,
  hasSelectionModifier,
  isRowAnimatedFromGroupToggle
} from "./listInteractions";
import groupStyles from "./MessageCardList.module.css";
import styles from "./MessageTable.module.css";

type SortKey = "date" | "from" | "subject";


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
    preferToDisplay: boolean;
    userEmail?: string;
    dateFormat?: AccountDateFormat;
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
    handleMessageDragStart: (event: React.DragEvent, message: Message, threadMessageIds?: string[]) => void;
    handleMessageDragEnd: () => void;
    handleRowClick: (event: React.MouseEvent, message: Message) => void;
    handleSelectMessage: (message: Message) => void;
    toggleMessageSelection: (messageId: string, replace?: boolean, setActive?: boolean) => void;
    selectRangeTo: (messageId: string) => void;
    selectCollapsedThread: (
      flat: Array<{ message: Message; depth: number }>,
      target: Message,
      options?: { isFlaggedGroup?: boolean }
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
    isTrashFolder: (folderId?: string) => boolean;
    renderMessageMenu: (
      message: Message,
      view: "table" | "list",
      onOpenChange?: (open: boolean) => void
    ) => React.ReactNode;
    handleShowRelated: (message: Message) => void;
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
    sortDir,
    preferToDisplay,
    userEmail,
    dateFormat
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
    isTrashFolder,
    renderMessageMenu,
    handleShowRelated
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

  const [lastGroupToggle, setLastGroupToggle] = useState<{
    key: string;
    open: boolean;
    at: number;
  } | null>(null);
  const [animationClock, setAnimationClock] = useState(0);

  useEffect(() => {
    if (!animationClock) return;
    const timer = window.setTimeout(() => setAnimationClock(0), 220);
    return () => {
      window.clearTimeout(timer);
    };
  }, [animationClock]);

  const rowHeight = 44;
  const groupHeight = 32;
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
        mode: "flat"
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
      preferToDisplay
    ]
  );

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
            From/To
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
        <div className={styles.cellActions} aria-hidden="true">
          {"\u00A0"}
        </div>
      </div>
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
        isRowAnimated={({ item }) =>
          isRowAnimatedFromGroupToggle({
            animationClock,
            lastGroupToggle,
            groupKey: item.groupKey
          })
        }
        renderRow={({ item, index }) => {
          const message = item.message;
          const dateDisplay = getMessageListDateDisplay(
            message.dateValue,
            message.date,
            dateFormat
          );
          const {
            isThreadSelectionRoot,
            threadSelectionIds,
            isThreadSelectionAllSelected,
            isThreadSelectionPartiallySelected,
            rowSelected,
            checkboxState,
            showThreadSelectionActive
          } = getThreadRowSelectionMeta({
            item,
            supportsThreads,
            selectedMessageIds,
            activeMessageId: activeMessageId ?? null,
            includeSubThreadRoots: true
          });
          const isDragging = draggingMessageIds.has(message.id);
          const optimistic =
            optimisticRow && optimisticRow.id === message.id
              ? optimisticRow
              : null;
          const effectiveSelected = optimistic ? optimistic.selected : rowSelected;
          const effectiveCheckboxState: boolean | "indeterminate" = optimistic
            ? optimistic.selected
            : checkboxState;
          const effectiveActive =
            message.id === activeMessageId || showThreadSelectionActive || Boolean(optimistic?.active);
          const isDisabled = pendingMessageActions.has(message.id);
          const showRowDivider = index > 0 && !item.isFirstInGroup;
          const { isCollapsedThreadRoot, displaySeen, threadMessages } = getThreadRowDisplayMeta({
            item
          });
          const rowClassName = [
            styles.row,
            showRowDivider ? styles.rowDivider : "",
            effectiveActive ? styles.rowActive : "",
            item.depth > 0 ? styles.threadChild : "",
            !showThreadSelectionActive &&
            activeThreadKey === item.threadGroupId &&
            message.id !== activeMessage?.id
              ? styles.threadSibling
              : "",
            !displaySeen ? styles.rowUnread : "",
            effectiveSelected ? styles.rowSelected : "",
            isDragging ? styles.rowDragging : "",
            isDisabled ? styles.rowDisabled : ""
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div
              className={rowClassName}
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
              onPointerDown={(event) => {
                if (isDisabled) return;
                if (event.button !== 0) return;
                const target = event.target as HTMLElement | null;
                const isRowControl = Boolean(target?.closest('[data-no-row-select="true"]'));
                const isCheckbox = Boolean(target?.closest('[role="checkbox"]'));
                const isInteractive = Boolean(
                  target?.closest("button, a, input, select, textarea")
                );
                if (isRowControl || (isInteractive && !isCheckbox)) return;
                const isToggle = event.metaKey || event.ctrlKey;
                const isRange = event.shiftKey;
                setOptimisticRow({
                  id: message.id,
                  selected:
                    isCheckbox || isToggle
                      ? isThreadSelectionRoot && isThreadSelectionPartiallySelected
                        ? true
                        : !rowSelected
                      : true,
                  active: !isCheckbox && !isToggle && !isRange
                });
                scheduleClear();
                if (!isCheckbox && !isToggle && !isRange) {
                  handleSelectMessage(message);
                }
              }}
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
                <span className={styles.cellSelect}>
                  {renderUnreadDot(message, {
                    seen: displaySeen,
                    threadMessages
                  })}
                  {renderSelectIndicators(message)}
                  <Checkbox
                    size="1"
                    checked={effectiveCheckboxState}
                    aria-label="Select message"
                    disabled={isDisabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRowCheckboxChange({
                        shiftKey: event.shiftKey,
                        messageId: message.id,
                        isThreadSelectionRoot,
                        selectedMessageIds,
                        threadSelectionIds,
                        isThreadSelectionAllSelected,
                        selectionStore,
                        selectRangeTo,
                        toggleMessageSelection,
                        setLastSelectedIdRef
                      });
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
                        data-no-row-select="true"
                        className={`${styles.threadCaret} ${
                          item.isCollapsed ? "" : styles.threadCaretOpen
                        }`}
                        title={item.isCollapsed ? "Expand thread" : "Collapse thread"}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                        }}
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
                  {item.showRecipientIcon && (
                    <span className={styles.recipientIcon} title="Recipients" aria-label="Recipients">
                      <MoveRight size={12} />
                    </span>
                  )}
                  <span className={styles.cellFromText} title={item.fromTooltip}>
                    {item.fromText}
                  </span>
                </span>
                <span
                  className={styles.cellSubject}
                  onClick={(event) => {
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
                >
                  {renderFolderBadges(item.folderIds)}
                  <span className={styles.cellSubjectText}>{message.subject}</span>
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
                  <IconButton
                    size="1"
                    variant="ghost"
                    color="gray"
                    title="Find related"
                    aria-label="Find related"
                    disabled={pendingMessageActions.has(message.id)}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleShowRelated(message);
                    }}
                  >
                    <Search size={14} />
                  </IconButton>
                  {renderMessageMenu(message, "table")}
                </div>
              </div>
          );
        }}
      />
    </div>
  );

}
