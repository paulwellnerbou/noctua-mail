import type React from "react";
import { MoreVertical } from "lucide-react";
import type { Folder } from "@/lib/data";

type FolderTreeNodeProps = {
  folder: Folder;
  depth: number;
  forceShow: boolean;
  state: {
    folderTree: Map<string, Folder[]>;
    folderById: Map<string, Folder>;
    folderQueryText: string;
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
  helpers: {
    hasFolderMatch: (folder: Folder) => boolean;
    isSystemFolder: (folder: Folder) => boolean;
    folderPathLabel: (folder: Folder) => string;
  };
};

export default function FolderTreeNode({
  folder,
  depth,
  forceShow,
  state,
  actions,
  refs,
  helpers
}: FolderTreeNodeProps) {
  const {
    folderTree,
    folderQueryText,
    activeFolderId,
    collapsedFolders,
    syncingFolders,
    deletingFolderIds,
    draggingMessageIds,
    dragOverFolderId,
    openFolderMenuId,
    messageCountByFolder
  } = state;
  const {
    setActiveFolderId,
    setSearchScope,
    clearSearch,
    setCollapsedFolders,
    setDragOverFolderId,
    setOpenFolderMenuId,
    handleMoveMessages,
    handleCreateSubfolder,
    handleRenameFolderItem,
    handleDeleteFolderItem,
    syncAccount,
    folderSpecialIcon
  } = actions;
  const { folderMenuRef } = refs;
  const { hasFolderMatch, isSystemFolder, folderPathLabel } = helpers;

  const isCollapsed = collapsedFolders[folder.id] ?? false;
  const hasChildren = (folderTree.get(folder.id) ?? []).length > 0;
  const isSystem = isSystemFolder(folder);
  if (folderQueryText && !forceShow && !hasFolderMatch(folder)) {
    return null;
  }
  const matchesQuery = folderQueryText
    ? folder.name.toLowerCase().includes(folderQueryText)
    : true;
  const childNodes = folderTree.get(folder.id) ?? [];
  const fullPath = folderPathLabel(folder);
  const totalCount = messageCountByFolder.get(folder.id) ?? folder.count ?? 0;
  const unreadCount = folder.unreadCount ?? 0;
  const folderTitle = `${fullPath} (${totalCount} Messages, ${unreadCount} Unread)`;
  const isDeleting = deletingFolderIds.has(folder.id);
  const isSyncingFolder = syncingFolders.has(folder.id);

  return (
    <div
      key={folder.id}
      className={`tree-node ${dragOverFolderId === folder.id ? "drop-target" : ""}`}
    >
      <div
        className={`tree-row ${folder.id === activeFolderId ? "active" : ""}${
          isDeleting ? " disabled" : ""
        }`}
        data-syncing={isSyncingFolder ? "true" : "false"}
        data-menu-open={openFolderMenuId === folder.id ? "true" : "false"}
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
          className={`tree-caret ${!isCollapsed ? "open" : ""}`}
          onClick={(event) => {
            if (!hasChildren) return;
            event.stopPropagation();
            if (isDeleting) return;
            setCollapsedFolders((prev) => ({ ...prev, [folder.id]: !isCollapsed }));
          }}
        >
          {hasChildren ? "▸" : ""}
        </span>
        {folderSpecialIcon(folder) ? (
          <span className="tree-icon" aria-hidden>
            {folderSpecialIcon(folder)}
          </span>
        ) : (
          <span className={`tree-dot ${isSystem ? "system" : ""}`} aria-hidden />
        )}
        <span className={`tree-name ${folder.unreadCount ? "has-unread" : ""}`}>
          {isSyncingFolder && <span className="tree-sync-spinner" aria-hidden="true" />}
          <span className="tree-name-text">{folder.name}</span>
        </span>
        {folder.unreadCount ? (
          <span className="tree-unread" aria-label={`${folder.unreadCount} unread`}>
            {folder.unreadCount}
          </span>
        ) : null}
        <span className="tree-actions">
          <div
            className="message-menu folder-menu"
            ref={openFolderMenuId === folder.id ? folderMenuRef : null}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="tree-action"
              title="Folder actions"
              aria-label="Folder actions"
              disabled={isDeleting}
              onClick={(event) => {
                event.stopPropagation();
                if (isDeleting) return;
                setOpenFolderMenuId((prev) => (prev === folder.id ? null : folder.id));
              }}
            >
              <MoreVertical size={14} />
            </button>
            {openFolderMenuId === folder.id && (
              <div className="message-menu-panel">
                <button
                  className="message-menu-item"
                  disabled={isDeleting || isSyncingFolder}
                  onClick={() => {
                    setOpenFolderMenuId(null);
                    syncAccount(folder.id);
                  }}
                >
                  Sync
                </button>
                <button
                  className="message-menu-item"
                  disabled={isDeleting}
                  onClick={() => {
                    setOpenFolderMenuId(null);
                    handleCreateSubfolder(folder);
                  }}
                >
                  Create Subfolder
                </button>
                <button
                  className="message-menu-item"
                  disabled={isDeleting}
                  onClick={() => {
                    setOpenFolderMenuId(null);
                    handleRenameFolderItem(folder);
                  }}
                >
                  Rename
                </button>
                <button
                  className="message-menu-item"
                  disabled={isDeleting}
                  onClick={() => {
                    setOpenFolderMenuId(null);
                    handleDeleteFolderItem(folder);
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </span>
      </div>
      {!isCollapsed && hasChildren && (
        <div className="tree-children">
          {childNodes.map((child) => (
            <FolderTreeNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              forceShow={matchesQuery}
              state={state}
              actions={actions}
              refs={refs}
              helpers={helpers}
            />
          ))}
        </div>
      )}
    </div>
  );
}
