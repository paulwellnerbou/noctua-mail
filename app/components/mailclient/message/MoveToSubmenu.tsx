"use client";

import { useState } from "react";
import { DropdownMenu } from "@radix-ui/themes";
import { FolderInput } from "lucide-react";
import type { Folder } from "@/lib/data";
import styles from "./MessageMenu.module.css";

type MoveToSubmenuProps = {
  onGetRecentFolders: () => Folder[];
  onMoveToFolder: (folderId: string) => void;
  onMoveToOther: () => void;
  disabled?: boolean;
};

/**
 * "Move to" submenu used by both the single-message DropdownMenu and the
 * multi-selection bulk context menu. Caller binds the target message(s)
 * inside its `onMoveToFolder` / `onMoveToOther` callbacks.
 *
 * Recent folders are fetched lazily when the submenu opens so the host
 * doesn't have to recompute the list on every render.
 */
export default function MoveToSubmenu({
  onGetRecentFolders,
  onMoveToFolder,
  onMoveToOther,
  disabled
}: MoveToSubmenuProps) {
  const [recentFolders, setRecentFolders] = useState<Folder[]>([]);

  return (
    <DropdownMenu.Sub
      onOpenChange={(open) => {
        if (open) setRecentFolders(onGetRecentFolders());
      }}
    >
      <DropdownMenu.SubTrigger disabled={disabled}>
        <span className={styles.menuIcon}>
          <FolderInput size={14} />
        </span>
        <span className={styles.menuLabel}>Move to</span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent className={styles.menuContent}>
        {recentFolders.map((folder) => (
          <DropdownMenu.Item
            key={folder.id}
            onSelect={() => onMoveToFolder(folder.id)}
          >
            <span className={styles.menuIcon}>
              <FolderInput size={14} />
            </span>
            <span className={styles.menuLabel}>{folder.name}</span>
          </DropdownMenu.Item>
        ))}
        {recentFolders.length > 0 && <DropdownMenu.Separator />}
        <DropdownMenu.Item onSelect={() => onMoveToOther()}>
          <span className={styles.menuIcon}>
            <FolderInput size={14} />
          </span>
          <span className={styles.menuLabel}>More...</span>
        </DropdownMenu.Item>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
  );
}
