"use client";

import { useState, useCallback, useMemo } from "react";
import { X, Clock, Folder as FolderIcon } from "lucide-react";
import { Dialog, IconButton, TextField } from "@radix-ui/themes";
import type { Folder } from "@/lib/data";
import FolderPickerNode from "../folder/FolderPickerNode";
import { folderSpecialIcon } from "../RenderHelpers";
import styles from "./MoveToDialog.module.css";

const RECENT_MOVE_FOLDERS_KEY = "noctua-recent-move-folders";
const MAX_RECENT = 5;

export function getRecentMoveFolderIds(accountId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_MOVE_FOLDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    return parsed[accountId] ?? [];
  } catch {
    return [];
  }
}

export function recordRecentMoveFolder(accountId: string, folderId: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(RECENT_MOVE_FOLDERS_KEY);
    const parsed: Record<string, string[]> = raw ? JSON.parse(raw) : {};
    const current = parsed[accountId] ?? [];
    const updated = [folderId, ...current.filter((id) => id !== folderId)].slice(0, MAX_RECENT);
    parsed[accountId] = updated;
    localStorage.setItem(RECENT_MOVE_FOLDERS_KEY, JSON.stringify(parsed));
  } catch {
    // ignore
  }
}

type MoveToDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  rootFolders: Folder[];
  folderTree: Map<string, Folder[]>;
  folderById: Map<string, Folder>;
  onMove: (folderId: string) => void;
};

export default function MoveToDialog({
  open,
  onOpenChange,
  accountId,
  rootFolders,
  folderTree,
  folderById,
  onMove
}: MoveToDialogProps) {
  const [query, setQuery] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});

  const recentIds = useMemo(
    () => (open ? getRecentMoveFolderIds(accountId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, accountId]
  );

  const recentFolders = useMemo(
    () => recentIds.flatMap((id) => (folderById.has(id) ? [folderById.get(id)!] : [])),
    [recentIds, folderById]
  );

  const folderQueryText = query.trim().toLowerCase();

  const hasFolderMatch = useCallback(
    (folder: Folder): boolean => {
      if (!folderQueryText) return true;
      if (folder.name.toLowerCase().includes(folderQueryText)) return true;
      const children = folderTree.get(folder.id) ?? [];
      return children.some((child) => hasFolderMatch(child));
    },
    [folderQueryText, folderTree]
  );

  const onToggleCollapse = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  }, []);

  const handleSelect = useCallback(
    (folderId: string) => {
      onMove(folderId);
      onOpenChange(false);
    },
    [onMove, onOpenChange]
  );

  const hasNoResults =
    folderQueryText.length > 0 && !rootFolders.some((f) => hasFolderMatch(f));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        className={styles.dialogContent}
        aria-label="Move to folder"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className={styles.dialogHeader}>
          <Dialog.Title className={styles.dialogTitle}>Move to...</Dialog.Title>
          <Dialog.Close>
            <IconButton variant="ghost" size="1" aria-label="Close">
              <X size={14} />
            </IconButton>
          </Dialog.Close>
        </div>

        <div className={styles.searchArea}>
          <TextField.Root
            size="2"
            type="search"
            placeholder="Search folders"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className={styles.searchInput}
          >
            {query ? (
              <TextField.Slot side="right">
                <IconButton
                  size="1"
                  variant="ghost"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                >
                  <X size={12} />
                </IconButton>
              </TextField.Slot>
            ) : null}
          </TextField.Root>
        </div>

        <div className={styles.scrollArea}>
          {recentFolders.length > 0 && !folderQueryText && (
            <div className={styles.recentSection}>
              <div className={styles.sectionLabel}>Recent</div>
              {recentFolders.map((folder) => {
                const icon = folderSpecialIcon(folder);
                return (
                  <button
                    key={folder.id}
                    type="button"
                    className={styles.recentRow}
                    onClick={() => handleSelect(folder.id)}
                  >
                    <span className={styles.recentIcon} aria-hidden>
                      {icon ?? <FolderIcon size={14} />}
                    </span>
                    {folder.name}
                  </button>
                );
              })}
            </div>
          )}

          <div className={styles.folderSection}>
            {!folderQueryText && <div className={styles.sectionLabel}>Folders</div>}
            {hasNoResults ? (
              <div className={styles.emptyState}>No folders match &ldquo;{query}&rdquo;</div>
            ) : (
              rootFolders.map((folder) => (
                <FolderPickerNode
                  key={folder.id}
                  folder={folder}
                  depth={0}
                  forceShow={false}
                  folderTree={folderTree}
                  folderById={folderById}
                  folderQueryText={folderQueryText}
                  collapsedFolders={collapsedFolders}
                  onToggleCollapse={onToggleCollapse}
                  onSelectFolder={handleSelect}
                  folderSpecialIcon={folderSpecialIcon}
                  hasFolderMatch={hasFolderMatch}
                />
              ))
            )}
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
