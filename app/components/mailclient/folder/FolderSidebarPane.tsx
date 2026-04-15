"use client";

import type React from "react";
import { useState } from "react";
import type { Folder, Topic } from "@/lib/data";
import FolderPane from "./FolderPane";
import FolderTree from "./FolderTree";
import TopicsSidebarSection from "./TopicsSidebarSection";
import type { SyncTriggerOptions } from "../types";

type VirtualFolder = {
  id: string;
  name: string;
  description: string;
  active: boolean;
  count?: number | null;
  countLabel?: string;
  countAriaLabel?: string;
  countTitle?: string;
  rowTitle?: string;
  emphasize?: boolean;
  icon: React.ReactNode;
};

type Props = {
  // Layout
  leftWidth: number;

  // Folder pane header / virtual folders
  accountFolderCount: number;
  virtualFolders: VirtualFolder[];
  isRecomputingThreads: boolean;
  isRecomputingCategories: boolean;
  activateVirtualFolder: (virtualFolderId: string) => void;
  syncAccount: (
    folderId?: string,
    mode?: "new" | "full",
    options?: SyncTriggerOptions
  ) => void;
  recomputeThreads: () => void;
  recomputeCategories: () => void;

  // Topics section
  allTopics: Topic[];
  topicMessageCountById?: ReadonlyMap<string, number>;
  activeTopicId: string | null;
  onTopicClick: (topicId: string) => void;

  // Folder tree data
  rootFolders: Folder[];
  folderTree: Map<string, Folder[]>;
  folderById: Map<string, Folder>;

  // Folder tree selection / search
  searchScope: "folder" | "all";
  activeFolderId: string;
  setActiveFolderId: React.Dispatch<React.SetStateAction<string>>;
  setSearchScope: React.Dispatch<React.SetStateAction<"folder" | "all">>;
  clearSearch: () => void;

  // Folder tree async state
  syncingFolders: Set<string>;
  deletingFolderIds: Set<string>;
  draggingMessageIds: Set<string>;

  // Drag-over highlight — owned by MailClient because it is also reset by the
  // message drag-drop hook on drag end.
  dragOverFolderId: string | null;
  setDragOverFolderId: React.Dispatch<React.SetStateAction<string | null>>;

  // Folder tree actions
  handleMoveMessages: (folderId: string, messageIds: string[]) => void;
  handleCreateSubfolder: (folder: Folder) => void;
  handleRenameFolderItem: (folder: Folder) => void;
  handleDeleteFolderItem: (folder: Folder) => void;
  folderSpecialIcon: (folder: Folder) => React.ReactNode;
};

/**
 * Left sidebar that houses the virtual folders, topic shortcuts, and folder
 * tree. Owns the purely-local UI state that was previously threaded through
 * MailClient: the folder search query, the folder collapse map, the drag-over
 * highlight, and whether the topics section is collapsed.
 *
 * Everything outside that UI-only bucket — selection state, sync state, folder
 * data, handlers that touch the data layer — still lives in MailClient and
 * arrives as props.
 */
export default function FolderSidebarPane({
  leftWidth,
  accountFolderCount,
  virtualFolders,
  isRecomputingThreads,
  isRecomputingCategories,
  activateVirtualFolder,
  syncAccount,
  recomputeThreads,
  recomputeCategories,
  allTopics,
  topicMessageCountById,
  activeTopicId,
  onTopicClick,
  rootFolders,
  folderTree,
  folderById,
  searchScope,
  activeFolderId,
  setActiveFolderId,
  setSearchScope,
  clearSearch,
  syncingFolders,
  deletingFolderIds,
  draggingMessageIds,
  dragOverFolderId,
  setDragOverFolderId,
  handleMoveMessages,
  handleCreateSubfolder,
  handleRenameFolderItem,
  handleDeleteFolderItem,
  folderSpecialIcon
}: Props) {
  const [folderQuery, setFolderQuery] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [topicSidebarCollapsed, setTopicSidebarCollapsed] = useState(false);

  return (
    <FolderPane
      state={{
        leftWidth,
        folderQuery,
        accountFolderCount,
        virtualFolders,
        isRecomputingThreads,
        isRecomputingCategories
      }}
      actions={{
        setFolderQuery,
        activateVirtualFolder,
        syncAccount,
        recomputeThreads,
        recomputeCategories
      }}
      topSlot={
        <TopicsSidebarSection
          topics={allTopics}
          topicMessageCountById={topicMessageCountById}
          activeTopicId={activeTopicId}
          collapsed={topicSidebarCollapsed}
          onToggleCollapsed={() => setTopicSidebarCollapsed((v) => !v)}
          onTopicClick={onTopicClick}
        />
      }
    >
      <FolderTree
        state={{
          rootFolders,
          folderTree,
          folderById,
          folderQuery,
          searchScope,
          activeFolderId,
          collapsedFolders,
          syncingFolders,
          deletingFolderIds,
          draggingMessageIds,
          dragOverFolderId
        }}
        actions={{
          setActiveFolderId,
          setSearchScope,
          clearSearch,
          setCollapsedFolders,
          setDragOverFolderId,
          handleMoveMessages,
          handleCreateSubfolder,
          handleRenameFolderItem,
          handleDeleteFolderItem,
          syncAccount,
          folderSpecialIcon
        }}
      />
    </FolderPane>
  );
}
