import type React from "react";
import { GitBranch, Trash2 } from "lucide-react";
import type { Message } from "@/lib/data";

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
    hoveredThreadId: string | null;
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
    setHoveredThreadId: React.Dispatch<React.SetStateAction<string | null>>;
    handleMessageDragStart: (event: React.DragEvent, message: Message) => void;
    handleMessageDragEnd: () => void;
    handleRowClick: (event: React.MouseEvent, message: Message) => void;
    handleSelectMessage: (message: Message) => void;
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
    isPinnedMessage: (message: Message) => boolean;
    isTrashFolder: (folderId?: string) => boolean;
    renderMessageMenu: (message: Message, view: "table" | "list") => React.ReactNode;
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
    hoveredThreadId,
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
    setHoveredThreadId,
    handleMessageDragStart,
    handleMessageDragEnd,
    handleRowClick,
    handleSelectMessage,
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
    isPinnedMessage,
    isTrashFolder,
    renderMessageMenu
  } = helpers;

  return (
    <div className="message-table">
      <div className="table-row table-header">
        <div className="cell-select" aria-hidden="true">
          <input
            type="checkbox"
            aria-label="Select all"
            onChange={() => {
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
            checked={
              visibleMessages.length > 0 &&
              visibleMessages.every((item) => selectedMessageIds.has(item.message.id))
            }
          />
        </div>
        <button
          className="table-sort"
          onClick={() => {
            setSortKey("from");
            setSortDir(sortDir === "asc" ? "desc" : "asc");
          }}
        >
          From
        </button>
        <button
          className="table-sort"
          onClick={() => {
            setSortKey("subject");
            setSortDir(sortDir === "asc" ? "desc" : "asc");
          }}
        >
          Subject
        </button>
        <button
          className="table-sort"
          onClick={() => {
            setSortKey("date");
            setSortDir(sortDir === "asc" ? "desc" : "asc");
          }}
        >
          Date
        </button>
        <div className="cell-actions" aria-hidden="true" />
      </div>
      {groupedMessages.map((group) => (
        <div key={group.key} className="table-group">
          <div
            className={`group-title group-toggle ${group.key === "Pinned" ? "pinned" : ""}`}
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
            <span className={`group-caret ${collapsedGroups[group.key] ? "" : "open"}`}>
              {group.items.length === 0 ? "" : "▸"}
            </span>
            {getGroupLabel(group)} · {group.items.length === 0 ? 0 : group.count ?? group.items.length}
          </div>
          {group.items.length > 0 && !collapsedGroups[group.key] && (
            <>
              {supportsThreads
                ? buildThreadTree(group.items)
                    .sort((a, b) => getThreadLatestDate(b) - getThreadLatestDate(a))
                    .map((root) => {
                      const isPinnedGroup = group.key === "Pinned";
                      const threadGroupId =
                        root.message.threadId ?? root.message.messageId ?? root.message.id;
                      const activeThreadKey =
                        activeMessage?.threadId ??
                        activeMessage?.messageId ??
                        activeMessage?.id;
                      const fullFlat = flattenThread(root, 0);
                      const threadSize = fullFlat.length;
                      const isCollapsed = collapsedThreads[threadGroupId] ?? true;
                      const flat = isCollapsed ? [fullFlat[0]] : fullFlat;
                      const threadFolderIds = Array.from(
                        new Set(fullFlat.map((item) => item.message.folderId))
                      );
                      const showThreadFolderBadges =
                        searchScope === "all" ||
                        (includeThreadAcrossFolders && threadFolderIds.length > 1);
                      return (
                        <div key={`${threadGroupId}-${root.message.id}`}>
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
                            return (
                              <div
                                key={message.id}
                                className={`table-row ${message.id === activeMessageId ? "active" : ""} ${
                                  depth > 0 ? "thread-child" : ""
                                } ${
                                  (hoveredThreadId === threadGroupId ||
                                    activeThreadKey === threadGroupId) &&
                                  message.id !== activeMessage?.id
                                    ? "thread-sibling"
                                    : ""
                                } ${!message.seen ? "unread" : ""} ${
                                  isSelected ? "selected" : ""
                                } ${isDragging ? "dragging" : ""} ${
                                  pendingMessageActions.has(message.id) ? "disabled" : ""
                                }`}
                                role="button"
                                tabIndex={0}
                                draggable
                                onDragStart={(event) => handleMessageDragStart(event, message)}
                                onDragEnd={handleMessageDragEnd}
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
                                onMouseEnter={() => setHoveredThreadId(threadGroupId)}
                                onMouseLeave={() => setHoveredThreadId(null)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    handleSelectMessage(message);
                                  }
                                }}
                              >
                                <span className="cell-select">
                                  {renderUnreadDot(message)}
                                  {renderSelectIndicators(message)}
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={(event) => {
                                      event.stopPropagation();
                                      toggleMessageSelection(message.id);
                                    }}
                                    onClick={(event) => event.stopPropagation()}
                                  />
                                </span>
                                <span className="cell-from" style={{ paddingLeft: `${depth * 14}px` }}>
                                  {index === 0 && threadSize > 1 ? (
                                    <>
                                      <span
                                        className={`thread-caret ${isCollapsed ? "" : "open"}`}
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
                                      <span className="thread-indicator thread-indicator-inline">
                                        <GitBranch size={12} />
                                        <span>{threadSize}</span>
                                      </span>
                                    </>
                                  ) : (
                                    <span className="thread-caret spacer">▸</span>
                                  )}
                                  {message.from}
                                </span>
                                <span
                                  className="cell-subject"
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
                                  <span className="cell-subject-text">{message.subject}</span>
                                </span>
                                <span className="cell-date">
                                  <span className="date-text">{message.date}</span>
                                </span>
                                <div className="cell-actions">
                                  <button
                                    className="icon-button ghost message-delete"
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
                                  </button>
                                  {renderMessageMenu(message, "table")}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })
                : group.items.map((message) => {
                    const threadGroupId = message.threadId ?? message.messageId ?? message.id;
                    const activeThreadKey =
                      activeMessage?.threadId ?? activeMessage?.messageId ?? activeMessage?.id;
                    const folderIds =
                      searchScope === "all" ||
                      (includeThreadAcrossFolders && message.folderId !== activeFolderId)
                        ? [message.folderId]
                        : [];
                    return (
                      <div
                        key={message.id}
                        className={`table-row ${message.id === activeMessageId ? "active" : ""} ${
                          (hoveredThreadId === threadGroupId ||
                            activeThreadKey === threadGroupId) &&
                          message.id !== activeMessage?.id
                            ? "thread-sibling"
                            : ""
                        } ${!message.seen ? "unread" : ""} ${
                          selectedMessageIds.has(message.id) ? "selected" : ""
                        } ${draggingMessageIds.has(message.id) ? "dragging" : ""} ${
                          pendingMessageActions.has(message.id) ? "disabled" : ""
                        }`}
                        role="button"
                        tabIndex={0}
                        draggable
                        onDragStart={(event) => handleMessageDragStart(event, message)}
                        onDragEnd={handleMessageDragEnd}
                        onClick={(event) => handleRowClick(event, message)}
                        onMouseEnter={() => setHoveredThreadId(threadGroupId)}
                        onMouseLeave={() => setHoveredThreadId(null)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleSelectMessage(message);
                          }
                        }}
                      >
                        <span className="cell-select">
                          {renderUnreadDot(message)}
                          {renderSelectIndicators(message)}
                          <input
                            type="checkbox"
                            checked={selectedMessageIds.has(message.id)}
                            onChange={(event) => {
                              event.stopPropagation();
                              toggleMessageSelection(message.id);
                            }}
                            onClick={(event) => event.stopPropagation()}
                          />
                        </span>
                        <span className="cell-from">{message.from}</span>
                        <span className="cell-subject">
                          {renderFolderBadges(folderIds)}
                          <span className="cell-subject-text">{message.subject}</span>
                        </span>
                        <span className="cell-date">
                          <span className="date-text">{message.date}</span>
                        </span>
                        <div className="cell-actions">
                          <button
                            className="icon-button ghost message-delete"
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
                          </button>
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
