import type React from "react";
import type { AccountDateFormat, Message, RecipientAlias, Topic } from "@/lib/data";
import type { MessageGroup, ThreadNode, VisibleMessageEntry } from "./listModel";
import type { SelectionStore } from "./selectionStore";

export type SortKey = "date" | "from" | "subject";

/**
 * The four layouts the message list can render in. Adding a new layout
 * requires touching only this list — the derived `MessageViewMode` type
 * and the orchestrator's runtime validator both read from it.
 */
export const MESSAGE_VIEW_MODES = ["card", "table", "compact", "threads"] as const;
export type MessageViewMode = (typeof MESSAGE_VIEW_MODES)[number];

export type MessageListViewState = {
  groupedMessages: MessageGroup[];
  visibleMessages: VisibleMessageEntry[];
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
  messageTopicsById: Map<string, Topic[]>;
  suggestedThreadIds: ReadonlySet<string>;
  pendingSuggestedThreadIds: ReadonlySet<string>;
  sortDir: "asc" | "desc";
  listIsNarrow: boolean;
  preferToDisplay: boolean;
  activeTopic: Topic | null;
  userEmail?: string;
  findRecipientAlias?: (value?: string | null) => RecipientAlias | null;
  dateFormat?: AccountDateFormat;
  topicColorRows?: boolean;
  senderIconsEnabled?: boolean;
};

export type MessageListViewRefs = {
  scrollRef: React.RefObject<HTMLDivElement | null>;
};

export type MessageListViewActions = {
  setSortKey: React.Dispatch<React.SetStateAction<SortKey>>;
  setSortDir: React.Dispatch<React.SetStateAction<"asc" | "desc">>;
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setCollapsedThreads: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  setLastSelectedIdRef: (id: string | null) => void;
  handleMessageDragStart: (
    event: React.DragEvent,
    message: Message,
    threadMessageIds?: string[]
  ) => void;
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
  toggleFlaggedFlag: (message: Message, collapsedThreadMessages?: Message[]) => void;
  toggleTodoFlag: (
    message: Message,
    collapsedThreadMessages?: Message[],
    clickedBadge?: "todo" | "done"
  ) => void;
  handleAddSuggestedThread: (threadId: string) => void;
};

export type MessageListViewHelpers = {
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

export type MessageListViewProps = {
  view: MessageViewMode;
  state: MessageListViewState;
  refs: MessageListViewRefs;
  actions: MessageListViewActions;
  helpers: MessageListViewHelpers;
};

export type MessageTableProps = {
  state: MessageListViewState;
  refs: MessageListViewRefs;
  actions: MessageListViewActions;
  helpers: MessageListViewHelpers;
};

export type MessageThreadListProps = {
  state: MessageListViewState;
  refs: MessageListViewRefs;
  actions: MessageListViewActions;
  helpers: MessageListViewHelpers;
};

export type MessageCardListProps = {
  state: MessageListViewState & { isCompactView: boolean };
  refs: MessageListViewRefs;
  actions: MessageListViewActions;
  helpers: MessageListViewHelpers;
};
