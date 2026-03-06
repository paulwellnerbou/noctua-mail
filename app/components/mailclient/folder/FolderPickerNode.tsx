import { useState } from "react";
import type React from "react";
import { Folder as FolderIcon } from "lucide-react";
import { CaretRightIcon } from "@radix-ui/react-icons";
import type { Folder } from "@/lib/data";
import styles from "./FolderTree.module.css";

type FolderPickerNodeProps = {
  folder: Folder;
  depth: number;
  forceShow: boolean;
  folderTree: Map<string, Folder[]>;
  folderById: Map<string, Folder>;
  folderQueryText: string;
  collapsedFolders: Record<string, boolean>;
  onToggleCollapse: (folderId: string) => void;
  onSelectFolder: (folderId: string) => void;
  folderSpecialIcon: (folder: Folder) => React.ReactNode;
  hasFolderMatch: (folder: Folder) => boolean;
};

export default function FolderPickerNode({
  folder,
  depth,
  forceShow,
  folderTree,
  folderById: _folderById,
  folderQueryText,
  collapsedFolders,
  onToggleCollapse,
  onSelectFolder,
  folderSpecialIcon,
  hasFolderMatch
}: FolderPickerNodeProps) {
  const isCollapsed = collapsedFolders[folder.id] ?? false;
  const childNodes = folderTree.get(folder.id) ?? [];
  const hasChildren = childNodes.length > 0;
  const specialIcon = folderSpecialIcon(folder);

  if (folderQueryText && !forceShow && !hasFolderMatch(folder)) {
    return null;
  }

  const matchesQuery = folderQueryText
    ? folder.name.toLowerCase().includes(folderQueryText)
    : true;

  return (
    <div className={styles.treeNode}>
      <div
        className={styles.treeRow}
        role="button"
        tabIndex={0}
        style={{ paddingLeft: `${6 + depth * 2}px` }}
        onClick={() => onSelectFolder(folder.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelectFolder(folder.id);
          }
        }}
      >
        <span
          className={`${styles.treeCaret} ${!isCollapsed ? styles.treeCaretOpen : ""}`}
          onClick={(event) => {
            if (!hasChildren) return;
            event.stopPropagation();
            onToggleCollapse(folder.id);
          }}
        >
          {hasChildren ? <CaretRightIcon /> : ""}
        </span>
        <span className={styles.treeIcon} aria-hidden>
          {specialIcon ?? <FolderIcon size={14} />}
        </span>
        <span className={styles.treeName}>
          <span className={styles.treeNameText}>{folder.name}</span>
        </span>
      </div>
      {!isCollapsed && hasChildren && (
        <div className={styles.treeChildren}>
          {childNodes.map((child) => (
            <FolderPickerNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              forceShow={matchesQuery}
              folderTree={folderTree}
              folderById={_folderById}
              folderQueryText={folderQueryText}
              collapsedFolders={collapsedFolders}
              onToggleCollapse={onToggleCollapse}
              onSelectFolder={onSelectFolder}
              folderSpecialIcon={folderSpecialIcon}
              hasFolderMatch={hasFolderMatch}
            />
          ))}
        </div>
      )}
    </div>
  );
}
