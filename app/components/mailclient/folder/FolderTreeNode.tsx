import { useState } from "react";
import type React from "react";
import { Folder as FolderIcon, MoreVertical } from "lucide-react";
import { Badge, DropdownMenu, IconButton } from "@radix-ui/themes";
import { CaretRightIcon } from "@radix-ui/react-icons";
import { badgeColors } from "@/lib/ui/badgeColors";
import type { Folder } from "@/lib/data";
import type { SyncTriggerOptions } from "../types";
import { getFolderCountTitle } from "./folderBadgePresentation";
import styles from "./FolderTree.module.css";

type FolderTreeNodeProps = {
  folder: Folder;
  depth: number;
  forceShow: boolean;
  state: {
    folderTree: Map<string, Folder[]>;
    folderById: Map<string, Folder>;
    folderQueryText: string;
    searchScope: "folder" | "all";
    activeFolderId: string;
    collapsedFolders: Record<string, boolean>;
    syncingFolders: Set<string>;
    deletingFolderIds: Set<string>;
    draggingMessageIds: Set<string>;
    dragOverFolderId: string | null;
  };
  actions: {
    setActiveFolderId: React.Dispatch<React.SetStateAction<string>>;
    setSearchScope: React.Dispatch<React.SetStateAction<"folder" | "all">>;
    clearSearch: () => void;
    setCollapsedFolders: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    setDragOverFolderId: React.Dispatch<React.SetStateAction<string | null>>;
    handleMoveMessages: (folderId: string, messageIds: string[]) => void;
    handleCreateSubfolder: (folder: Folder) => void;
    handleRenameFolderItem: (folder: Folder) => void;
    handleDeleteFolderItem: (folder: Folder) => void;
    syncAccount: (
      folderId?: string,
      mode?: "new" | "full",
      options?: SyncTriggerOptions
    ) => void;
    folderSpecialIcon: (folder: Folder) => React.ReactNode;
  };
  helpers: {
    hasFolderMatch: (folder: Folder) => boolean;
    folderPathLabel: (folder: Folder) => string;
  };
};

export default function FolderTreeNode({
  folder,
  depth,
  forceShow,
  state,
  actions,
  helpers
}: FolderTreeNodeProps) {
  const {
    folderTree,
    folderQueryText,
    searchScope,
    activeFolderId,
    collapsedFolders,
    syncingFolders,
    deletingFolderIds,
    draggingMessageIds,
    dragOverFolderId
  } = state;
  const {
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
  } = actions;
  const { hasFolderMatch, folderPathLabel } = helpers;
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isCollapsed = collapsedFolders[folder.id] ?? false;
  const hasChildren = (folderTree.get(folder.id) ?? []).length > 0;
  const specialIcon = folderSpecialIcon(folder);
  if (folderQueryText && !forceShow && !hasFolderMatch(folder)) {
    return null;
  }
  const matchesQuery = folderQueryText
    ? folder.name.toLowerCase().includes(folderQueryText)
    : true;
  const childNodes = folderTree.get(folder.id) ?? [];
  const fullPath = folderPathLabel(folder);
  const folderTitle = getFolderCountTitle(fullPath, folder.count ?? 0, folder.unreadCount ?? 0);
  const isDeleting = deletingFolderIds.has(folder.id);
  const isSyncingFolder = syncingFolders.has(folder.id);

  return (
    <div
      key={folder.id}
      className={`${styles.treeNode} ${
        dragOverFolderId === folder.id ? styles.treeNodeDropTarget : ""
      }`}
    >
      <div
        className={`${styles.treeRow} ${
          searchScope === "folder" && folder.id === activeFolderId ? styles.treeRowActive : ""
        } ${isDeleting ? styles.treeRowDisabled : ""}`}
        data-syncing={isSyncingFolder ? "true" : "false"}
        data-menu-open={isMenuOpen ? "true" : "false"}
        title={folderTitle}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (isDeleting) return;
          clearSearch();
          setSearchScope("folder");
          setActiveFolderId(folder.id);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (isDeleting) return;
            clearSearch();
            setSearchScope("folder");
            setActiveFolderId(folder.id);
          }
        }}
        onDragOver={(event) => {
          if (isDeleting) return;
          if (!draggingMessageIds.size && !event.dataTransfer.types.includes("application/json")) {
            return;
          }
          event.preventDefault();
          setDragOverFolderId(folder.id);
          event.dataTransfer.dropEffect = "move";
        }}
        onDragLeave={() => {
          if (dragOverFolderId === folder.id) {
            setDragOverFolderId(null);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (isDeleting) return;
          setDragOverFolderId(null);
          let ids = draggingMessageIds.size > 0 ? Array.from(draggingMessageIds) : [];
          if (!ids.length) {
            try {
              const parsed = JSON.parse(event.dataTransfer.getData("application/json"));
              if (parsed?.messageIds && Array.isArray(parsed.messageIds)) {
                ids = parsed.messageIds;
              }
            } catch {
              // ignore
            }
          }
          if (!ids.length) return;
          handleMoveMessages(folder.id, ids);
        }}
        style={{ paddingLeft: `${6 + depth * 2}px` }}
      >
        <span
          className={`${styles.treeCaret} ${!isCollapsed ? styles.treeCaretOpen : ""}`}
          onClick={(event) => {
            if (!hasChildren) return;
            event.stopPropagation();
            if (isDeleting) return;
            setCollapsedFolders((prev) => ({ ...prev, [folder.id]: !isCollapsed }));
          }}
        >
          {hasChildren ? <CaretRightIcon /> : ""}
        </span>
        <span className={styles.treeIcon} aria-hidden>
          {specialIcon ?? <FolderIcon size={14} />}
        </span>
        <span className={`${styles.treeName} ${folder.unreadCount ? styles.treeNameUnread : ""}`}>
          <span className={styles.treeNameText}>{folder.name}</span>
          {isSyncingFolder && <span className={styles.treeSyncSpinner} aria-hidden="true" />}
        </span>
        {folder.unreadCount ? (
          <Badge
            size="1"
            variant="soft"
            color={badgeColors.unread}
            className={styles.treeUnreadBadge}
            aria-label={`${folder.unreadCount} unread`}
            title={folderTitle}
          >
            {folder.unreadCount}
          </Badge>
        ) : null}
        <span className={styles.treeActions}>
          <DropdownMenu.Root open={isMenuOpen} onOpenChange={setIsMenuOpen}>
            <DropdownMenu.Trigger>
              <IconButton
                className={styles.treeAction}
                variant="ghost"
                size="1"
                title="Folder actions"
                aria-label="Folder actions"
                disabled={isDeleting}
                onClick={(event) => event.stopPropagation()}
              >
                <MoreVertical size={14} />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" className={styles.menuContent}>
              <DropdownMenu.Item
                disabled={isDeleting || isSyncingFolder}
                onSelect={() => {
                  syncAccount(folder.id, "full", {
                    recategorizeFolder: true,
                    fullSyncReason: "Manual full folder sync from the folder tree."
                  });
                }}
              >
                Sync
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled={isDeleting}
                onSelect={() => {
                  handleCreateSubfolder(folder);
                }}
              >
                Create Subfolder
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled={isDeleting}
                onSelect={() => {
                  handleRenameFolderItem(folder);
                }}
              >
                Rename
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled={isDeleting}
                onSelect={() => {
                  handleDeleteFolderItem(folder);
                }}
              >
                Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </span>
      </div>
      {!isCollapsed && hasChildren && (
        <div className={styles.treeChildren}>
          {childNodes.map((child) => (
            <FolderTreeNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              forceShow={matchesQuery}
              state={state}
              actions={actions}
              helpers={helpers}
            />
          ))}
        </div>
      )}
    </div>
  );
}
