import type React from "react";
import type { Message } from "@/lib/data";
import { Text } from "@radix-ui/themes";
import MessageRow from "./MessageRow";
import { buildFlatEntries, buildThreadGroupEntries } from "./threadGroupUtils";
import styles from "./MessageCardList.module.css";

type MessageGroup = {
  key: string;
  label?: string;
  items: Message[];
  count?: number;
};

type ThreadNode = { message: Message; children: ThreadNode[]; threadSize: number };

type MessageCardListProps = {
  state: {
    groupedMessages: MessageGroup[];
    collapsedGroups: Record<string, boolean>;
    collapsedThreads: Record<string, boolean>;
    supportsThreads: boolean;
    includeThreadAcrossFolders: boolean;
    searchScope: "folder" | "all";
    activeFolderId: string;
    activeMessageId: string;
    activeMessage: Message | null;
    selectedMessageIds: Set<string>;
    draggingMessageIds: Set<string>;
    pendingMessageActions: Set<string>;
    isCompactView: boolean;
    listIsNarrow: boolean;
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
    isPinnedMessage: (message: Message) => boolean;
    isTrashFolder: (folderId?: string) => boolean;
  };
};

export default function MessageCardList({ state, actions, helpers }: MessageCardListProps) {
  const {
    groupedMessages,
    collapsedGroups,
    collapsedThreads,
    supportsThreads,
    includeThreadAcrossFolders,
    searchScope,
    activeFolderId,
    activeMessageId,
    activeMessage,
    selectedMessageIds,
    draggingMessageIds,
    pendingMessageActions,
    isCompactView,
    listIsNarrow
  } = state;

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
    isPinnedMessage,
    isTrashFolder
  } = helpers;

  return (
    <>
      {groupedMessages.map((group) => (
        <div
          key={group.key}
          className={`${styles.group} ${isCompactView ? styles.groupCompact : ""}`}
        >
          <div
            className={`${styles.groupTitle} ${styles.groupToggle} ${
              group.key === "Pinned" ? styles.groupTitlePinned : ""
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
              className={`${styles.groupCaret} ${
                collapsedGroups[group.key] ? "" : styles.groupCaretOpen
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
                  }).map((entry, threadIndex) => {
                    const isPinnedGroup = group.key === "Pinned";
                    const threadGroupId = entry.threadGroupId;
                    const activeThreadKey =
                      activeMessage?.threadId ?? activeMessage?.messageId ?? activeMessage?.id;
                    const fullFlat = entry.fullFlat;
                    const threadSize = entry.threadSize;
                    const isCollapsed = entry.isCollapsed;
                    const flat = entry.flat;
                    const threadFolderIds = entry.threadFolderIds;
                    const showThreadFolderBadges = entry.showThreadFolderBadges;
                    return (
                      <div
                        key={`${threadGroupId}-${entry.root.message.id}`}
                        className={`${styles.threadGroup} ${
                          isCompactView ? styles.threadGroupCompact : ""
                        }`}
                      >
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
                          const folderBadgeKey = folderIds.length ? folderIds.join("|") : "";
                          const isActiveThread =
                            !!activeMessageId &&
                            fullFlat.some((item) => item.message.id === activeMessageId);
                          const showCollapsedActive =
                            isCompactView &&
                            isCollapsed &&
                            index === 0 &&
                            depth === 0 &&
                            threadSize > 1 &&
                            isActiveThread;
                          const showCompactDivider = isCompactView && (threadIndex > 0 || index > 0);

                          return (
                            <MessageRow
                              key={message.id}
                              message={message}
                              isCompactView={isCompactView}
                              listIsNarrow={listIsNarrow}
                              isActive={message.id === activeMessageId}
                              isThreadChild={depth > 0}
                              isThreadSibling={
                                activeThreadKey === threadGroupId &&
                                message.id !== activeMessage?.id
                              }
                              isSelected={isSelected}
                              isDragging={isDragging}
                              isDisabled={pendingMessageActions.has(message.id)}
                              showCollapsedActive={showCollapsedActive}
                              paddingLeft={14 + depth * 10}
                              showThreadCaret={index === 0 && threadSize > 1}
                              isThreadCaretOpen={!isCollapsed}
                              onThreadCaretClick={() => {
                                setCollapsedThreads((prev) => ({
                                  ...prev,
                                  [threadGroupId]: !isCollapsed
                                }));
                              }}
                              showThreadIndicator={threadSize > 1 && index === 0}
                              threadSize={threadSize}
                              showCompactDivider={showCompactDivider}
                              onRowClick={(event) => {
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
                              onDelete={(event) => {
                                event.stopPropagation();
                                handleDeleteMessage(message);
                              }}
                              deleteTitle={
                                isTrashFolder(message.folderId)
                                  ? "Delete permanently"
                                  : "Move to Trash"
                              }
                              renderUnreadDot={renderUnreadDot(message)}
                              renderSelectIndicators={renderSelectIndicators(message)}
                              folderBadges={renderFolderBadges(folderIds)}
                              folderBadgeKey={folderBadgeKey}
                              showFolderBadgesInSubjectMeta={isCompactView}
                              showFolderBadgesInMeta={!isCompactView}
                              quickActions={renderQuickActions(message)}
                              messageMenu={renderMessageMenu(message, isCompactView ? "table" : "list")}
                              showAttachmentIcon={
                                message.hasAttachments ??
                                (message.attachments?.some((att) => !att.inline) ?? false)
                              }
                              showNewBadge={
                                !Boolean(message.seen) &&
                                Boolean(message.recent) &&
                                !Boolean(message.draft)
                              }
                            />
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
                  }).map(({ message, threadGroupId, folderIds }, index) => {
                    const activeThreadKey =
                      activeMessage?.threadId ?? activeMessage?.messageId ?? activeMessage?.id;
                    const isSelected = selectedMessageIds.has(message.id);
                    const isDragging = draggingMessageIds.has(message.id);
                    const showCompactDivider = isCompactView && index > 0;
                    const folderBadgeKey = folderIds.length ? folderIds.join("|") : "";
                    return (
                      <MessageRow
                        key={message.id}
                        message={message}
                        isCompactView={isCompactView}
                        listIsNarrow={listIsNarrow}
                        isActive={message.id === activeMessageId}
                        isThreadChild={false}
                        isThreadSibling={
                          activeThreadKey === threadGroupId &&
                          message.id !== activeMessage?.id
                        }
                        isSelected={isSelected}
                        isDragging={isDragging}
                        isDisabled={pendingMessageActions.has(message.id)}
                        showCollapsedActive={false}
                        showThreadCaret={false}
                        isThreadCaretOpen={false}
                        showThreadIndicator={false}
                        showCompactDivider={showCompactDivider}
                        onRowClick={(event) => handleRowClick(event, message)}
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
                          handleSelectMessage(message);
                        }}
                        onDelete={(event) => {
                          event.stopPropagation();
                          handleDeleteMessage(message);
                        }}
                        deleteTitle={
                          isTrashFolder(message.folderId)
                            ? "Delete permanently"
                            : "Move to Trash"
                        }
                        renderUnreadDot={renderUnreadDot(message)}
                        renderSelectIndicators={renderSelectIndicators(message)}
                        folderBadges={renderFolderBadges(folderIds)}
                        folderBadgeKey={folderBadgeKey}
                        showFolderBadgesInSubjectMeta={isCompactView}
                        showFolderBadgesInMeta={!isCompactView}
                        quickActions={renderQuickActions(message)}
                        messageMenu={renderMessageMenu(message, isCompactView ? "table" : "list")}
                        showAttachmentIcon={
                          (message.attachments?.some((att) => !att.inline) ?? false)
                        }
                        showNewBadge={
                          !Boolean(message.seen) &&
                          Boolean(message.recent) &&
                          !Boolean(message.draft)
                        }
                      />
                    );
                  })}
            </>
          )}
        </div>
      ))}
    </>
  );
}
