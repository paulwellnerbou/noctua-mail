import type React from "react";
import type { AccountDateFormat, Message } from "@/lib/data";
import MessageCardList from "./MessageCardList";
import MessageTable from "./MessageTable";
import MessageThreadList from "./MessageThreadList";
import type { MessageGroup, ThreadNode } from "./listModel";
import type { SelectionStore } from "./selectionStore";

type SortKey = "date" | "from" | "subject";

type MessageListViewProps = {
  view: "card" | "table" | "compact" | "threads";
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
    listIsNarrow: boolean;
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
    selectRangeTo: (messageId: string) => void;
    toggleMessageSelection: (messageId: string, replace?: boolean, setActive?: boolean) => void;
    selectCollapsedThread: (
      flat: Array<{ message: Message; depth: number }>,
      target: Message,
      options?: { isFlaggedGroup?: boolean }
    ) => void;
    handleDeleteMessage: (message: Message) => void;
    toggleFlaggedFlag: (message: Message) => void;
    toggleTodoFlag: (message: Message) => void;
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

export default function MessageListView({
  view,
  state,
  actions,
  helpers,
  refs
}: MessageListViewProps) {
  if (view === "table") {
    return (
      <MessageTable
        state={{
          groupedMessages: state.groupedMessages,
          visibleMessages: state.visibleMessages,
          selectionStore: state.selectionStore,
          draggingMessageIds: state.draggingMessageIds,
          collapsedGroups: state.collapsedGroups,
          collapsedThreads: state.collapsedThreads,
          pendingMessageActions: state.pendingMessageActions,
          supportsThreads: state.supportsThreads,
          includeThreadAcrossFolders: state.includeThreadAcrossFolders,
          searchScope: state.searchScope,
          activeFolderId: state.activeFolderId,
          messageById: state.messageById,
          sortDir: state.sortDir,
          preferToDisplay: state.preferToDisplay,
          userEmail: state.userEmail,
          dateFormat: state.dateFormat
        }}
        actions={{
          setSortKey: actions.setSortKey,
          setSortDir: actions.setSortDir,
          setCollapsedGroups: actions.setCollapsedGroups,
          setCollapsedThreads: actions.setCollapsedThreads,
          setLastSelectedIdRef: actions.setLastSelectedIdRef,
          handleMessageDragStart: actions.handleMessageDragStart,
          handleMessageDragEnd: actions.handleMessageDragEnd,
          handleRowClick: actions.handleRowClick,
          handleSelectMessage: actions.handleSelectMessage,
          toggleMessageSelection: actions.toggleMessageSelection,
          selectRangeTo: actions.selectRangeTo,
          selectCollapsedThread: actions.selectCollapsedThread,
          handleDeleteMessage: actions.handleDeleteMessage
        }}
        helpers={{
          buildThreadTree: helpers.buildThreadTree,
          flattenThread: helpers.flattenThread,
          getThreadLatestDate: helpers.getThreadLatestDate,
          getGroupLabel: helpers.getGroupLabel,
          renderUnreadDot: helpers.renderUnreadDot,
          renderSelectIndicators: helpers.renderSelectIndicators,
          renderFolderBadges: helpers.renderFolderBadges,
          isTrashFolder: helpers.isTrashFolder,
          renderMessageMenu: helpers.renderMessageMenu,
          handleShowRelated: helpers.handleShowRelated
        }}
        refs={refs}
      />
    );
  }

  if (view === "threads") {
    return (
      <MessageThreadList
        state={{
          groupedMessages: state.groupedMessages,
          collapsedGroups: state.collapsedGroups,
          collapsedThreads: state.collapsedThreads,
          supportsThreads: state.supportsThreads,
          includeThreadAcrossFolders: state.includeThreadAcrossFolders,
          searchScope: state.searchScope,
          activeFolderId: state.activeFolderId,
          messageById: state.messageById,
          selectionStore: state.selectionStore,
          draggingMessageIds: state.draggingMessageIds,
          pendingMessageActions: state.pendingMessageActions,
          preferToDisplay: state.preferToDisplay,
          userEmail: state.userEmail,
          dateFormat: state.dateFormat
        }}
        actions={{
          setCollapsedGroups: actions.setCollapsedGroups,
          setCollapsedThreads: actions.setCollapsedThreads,
          handleMessageDragStart: actions.handleMessageDragStart,
          handleMessageDragEnd: actions.handleMessageDragEnd,
          handleRowClick: actions.handleRowClick,
          handleSelectMessage: actions.handleSelectMessage,
          selectRangeTo: actions.selectRangeTo,
          toggleMessageSelection: actions.toggleMessageSelection,
          selectCollapsedThread: actions.selectCollapsedThread,
          handleDeleteMessage: actions.handleDeleteMessage,
          toggleFlaggedFlag: actions.toggleFlaggedFlag,
          toggleTodoFlag: actions.toggleTodoFlag
        }}
        helpers={{
          buildThreadTree: helpers.buildThreadTree,
          flattenThread: helpers.flattenThread,
          getThreadLatestDate: helpers.getThreadLatestDate,
          getGroupLabel: helpers.getGroupLabel,
          renderUnreadDot: helpers.renderUnreadDot,
          renderFolderBadges: helpers.renderFolderBadges,
          handleShowRelated: helpers.handleShowRelated,
          isTrashFolder: helpers.isTrashFolder,
          renderMessageMenu: helpers.renderMessageMenu
        }}
        refs={refs}
      />
    );
  }

  return (
    <MessageCardList
      state={{
        groupedMessages: state.groupedMessages,
        collapsedGroups: state.collapsedGroups,
        collapsedThreads: state.collapsedThreads,
        supportsThreads: state.supportsThreads,
        includeThreadAcrossFolders: state.includeThreadAcrossFolders,
        searchScope: state.searchScope,
        activeFolderId: state.activeFolderId,
        messageById: state.messageById,
        selectionStore: state.selectionStore,
        draggingMessageIds: state.draggingMessageIds,
        pendingMessageActions: state.pendingMessageActions,
        isCompactView: view === "compact",
        listIsNarrow: state.listIsNarrow,
        preferToDisplay: state.preferToDisplay,
        userEmail: state.userEmail,
        dateFormat: state.dateFormat
      }}
      actions={{
        setCollapsedGroups: actions.setCollapsedGroups,
        setCollapsedThreads: actions.setCollapsedThreads,
        handleMessageDragStart: actions.handleMessageDragStart,
        handleMessageDragEnd: actions.handleMessageDragEnd,
        handleRowClick: actions.handleRowClick,
        handleSelectMessage: actions.handleSelectMessage,
        selectRangeTo: actions.selectRangeTo,
        toggleMessageSelection: actions.toggleMessageSelection,
        selectCollapsedThread: actions.selectCollapsedThread,
        handleDeleteMessage: actions.handleDeleteMessage,
        toggleFlaggedFlag: actions.toggleFlaggedFlag,
        toggleTodoFlag: actions.toggleTodoFlag
      }}
      helpers={{
        buildThreadTree: helpers.buildThreadTree,
        flattenThread: helpers.flattenThread,
        getThreadLatestDate: helpers.getThreadLatestDate,
        getGroupLabel: helpers.getGroupLabel,
        renderUnreadDot: helpers.renderUnreadDot,
        renderSelectIndicators: helpers.renderSelectIndicators,
        renderFolderBadges: helpers.renderFolderBadges,
        renderQuickActions: helpers.renderQuickActions,
        renderMessageMenu: helpers.renderMessageMenu,
        handleShowRelated: helpers.handleShowRelated,
        isTrashFolder: helpers.isTrashFolder
      }}
      refs={refs}
    />
  );
}
