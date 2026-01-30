import type React from "react";
import type { Folder } from "@/lib/data";
import FolderTreeNode from "./FolderTreeNode";

const SYSTEM_FOLDER_NAMES = new Set([
  "Inbox",
  "Pinned",
  "Unread",
  "Drafts",
  "Sent",
  "Archive",
  "Trash",
  "Junk",
  "Spam"
]);

type FolderTreeProps = {
  state: {
    rootFolders: Folder[];
    folderTree: Map<string, Folder[]>;
    folderById: Map<string, Folder>;
    folderQuery: string;
    activeFolderId: string;
    collapsedFolders: Record<string, boolean>;
    syncingFolders: Set<string>;
    deletingFolderIds: Set<string>;
    draggingMessageIds: Set<string>;
    dragOverFolderId: string | null;
    openFolderMenuId: string | null;
    messageCountByFolder: Map<string, number>;
  };
  actions: {
    setActiveFolderId: React.Dispatch<React.SetStateAction<string>>;
    setSearchScope: React.Dispatch<React.SetStateAction<"folder" | "all">>;
    clearSearch: () => void;
    setCollapsedFolders: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    setDragOverFolderId: React.Dispatch<React.SetStateAction<string | null>>;
    setOpenFolderMenuId: React.Dispatch<React.SetStateAction<string | null>>;
    handleMoveMessages: (folderId: string, messageIds: string[]) => void;
    handleCreateSubfolder: (folder: Folder) => void;
    handleRenameFolderItem: (folder: Folder) => void;
    handleDeleteFolderItem: (folder: Folder) => void;
    syncAccount: (folderId?: string, mode?: "new" | "full") => void;
    folderSpecialIcon: (folder: Folder) => React.ReactNode;
  };
  refs: {
    folderMenuRef: React.RefObject<HTMLDivElement | null>;
  };
};

export default function FolderTree({ state, actions, refs }: FolderTreeProps) {
  const {
    rootFolders,
    folderTree,
    folderById,
    folderQuery,
    activeFolderId,
    collapsedFolders,
    syncingFolders,
    deletingFolderIds,
    draggingMessageIds,
    dragOverFolderId,
    openFolderMenuId,
    messageCountByFolder
  } = state;

  const folderQueryText = folderQuery.trim().toLowerCase();

  const hasFolderMatch = (folder: Folder): boolean => {
    if (!folderQueryText) return true;
    if (folder.name.toLowerCase().includes(folderQueryText)) return true;
    const children = folderTree.get(folder.id) ?? [];
    return children.some((child) => hasFolderMatch(child));
  };

  const isSystemFolder = (folder: Folder) => {
    const special = (folder.specialUse ?? "").toLowerCase();
    if (
      ["\\inbox", "\\sent", "\\drafts", "\\trash", "\\junk", "\\spam", "\\archive"].includes(
        special
      )
    ) {
      return true;
    }
    return SYSTEM_FOLDER_NAMES.has(folder.name);
  };

  const folderPathLabel = (folder: Folder) => {
    const parts = [folder.name];
    let parentId = folder.parentId ?? null;
    while (parentId) {
      const parent = folderById.get(parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      parentId = parent.parentId ?? null;
    }
    return parts.join("/");
  };

  return (
    <>
      {rootFolders.map((folder) => (
        <FolderTreeNode
          key={folder.id}
          folder={folder}
          depth={0}
          forceShow={false}
          state={{
            folderTree,
            folderById,
            folderQueryText,
            activeFolderId,
            collapsedFolders,
            syncingFolders,
            deletingFolderIds,
            draggingMessageIds,
            dragOverFolderId,
            openFolderMenuId,
            messageCountByFolder
          }}
          actions={actions}
          refs={refs}
          helpers={{ hasFolderMatch, isSystemFolder, folderPathLabel }}
        />
      ))}
    </>
  );
}
