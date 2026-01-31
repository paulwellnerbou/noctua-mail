import type { Message } from "@/lib/data";

type MessageGroup = {
  key: string;
  label?: string;
  items: Message[];
  count?: number;
};

type ThreadNode = { message: Message; children: ThreadNode[]; threadSize: number };

export type ThreadGroupEntry = {
  threadGroupId: string;
  threadSize: number;
  fullFlat: Array<{ message: Message; depth: number }>;
  flat: Array<{ message: Message; depth: number }>;
  threadFolderIds: string[];
  showThreadFolderBadges: boolean;
  isCollapsed: boolean;
  root: ThreadNode;
};

export type FlatMessageEntry = {
  message: Message;
  threadGroupId: string;
  folderIds: string[];
};

export function buildThreadGroupEntries(params: {
  group: MessageGroup;
  collapsedThreads: Record<string, boolean>;
  includeThreadAcrossFolders: boolean;
  searchScope: "folder" | "all";
  activeFolderId: string;
  buildThreadTree: (items: Message[]) => ThreadNode[];
  flattenThread: (
    node: ThreadNode,
    depth?: number,
    visited?: Set<string>
  ) => Array<{ message: Message; depth: number }>;
  getThreadLatestDate: (node: ThreadNode) => number;
}): ThreadGroupEntry[] {
  const {
    group,
    collapsedThreads,
    includeThreadAcrossFolders,
    searchScope,
    activeFolderId,
    buildThreadTree,
    flattenThread,
    getThreadLatestDate
  } = params;
  return buildThreadTree(group.items)
    .sort((a, b) => getThreadLatestDate(b) - getThreadLatestDate(a))
    .map((root) => {
      const threadGroupId = root.message.threadId ?? root.message.messageId ?? root.message.id;
      const fullFlat = flattenThread(root, 0);
      const threadSize = fullFlat.length;
      const isCollapsed = collapsedThreads[threadGroupId] ?? true;
      const flat = isCollapsed ? [fullFlat[0]] : fullFlat;
      const threadFolderIds = Array.from(
        new Set(fullFlat.map((item) => item.message.folderId))
      );
      const showThreadFolderBadges =
        searchScope === "all" || (includeThreadAcrossFolders && threadFolderIds.length > 1);
      return {
        threadGroupId,
        threadSize,
        fullFlat,
        flat,
        threadFolderIds,
        showThreadFolderBadges,
        isCollapsed,
        root
      };
    });
}

export function buildFlatEntries(params: {
  group: MessageGroup;
  includeThreadAcrossFolders: boolean;
  searchScope: "folder" | "all";
  activeFolderId: string;
}): FlatMessageEntry[] {
  const { group, includeThreadAcrossFolders, searchScope, activeFolderId } = params;
  return group.items.map((message) => {
    const threadGroupId = message.threadId ?? message.messageId ?? message.id;
    const folderIds =
      searchScope === "all" ||
      (includeThreadAcrossFolders && message.folderId !== activeFolderId)
        ? [message.folderId]
        : [];
    return { message, threadGroupId, folderIds };
  });
}
