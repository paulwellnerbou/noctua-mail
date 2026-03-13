import type React from "react";
import { MoreVertical, X } from "lucide-react";
import { Badge, DropdownMenu, IconButton, TextField } from "@radix-ui/themes";
import { badgeColors } from "@/lib/ui/badgeColors";
import styles from "./FolderTree.module.css";
type FolderPaneProps = {
  state: {
    leftWidth: number;
    folderQuery: string;
    accountFolderCount: number;
    virtualFolders: Array<{
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
    }>;
    isRecomputingThreads: boolean;
    isRecomputingCategories: boolean;
  };
  actions: {
    setFolderQuery: React.Dispatch<React.SetStateAction<string>>;
    activateVirtualFolder: (virtualFolderId: string) => void;
    syncAccount: (
      folderId?: string,
      mode?: "new" | "full",
      options?: { recategorizeFolder?: boolean }
    ) => void;
    recomputeThreads: () => void;
    recomputeCategories: () => void;
  };
  topSlot?: React.ReactNode;
  children?: React.ReactNode;
};

export default function FolderPane({ state, actions, topSlot, children }: FolderPaneProps) {
  const {
    leftWidth,
    folderQuery,
    accountFolderCount,
    virtualFolders,
    isRecomputingThreads,
    isRecomputingCategories
  } = state;
  const { setFolderQuery, activateVirtualFolder, syncAccount, recomputeThreads, recomputeCategories } =
    actions;

  return (
    <aside className={`pane ${styles.pane}`} style={{ width: leftWidth }}>
      <div className={styles.folderPanel}>
        <div className={styles.treeRail}>
          {virtualFolders.length > 0 ? (
            <div className={styles.virtualSection} aria-label="Virtual folders">
              {virtualFolders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className={`${styles.treeRow} ${styles.virtualRow} ${
                    folder.active ? styles.treeRowActive : ""
                  }`}
                  onClick={() => activateVirtualFolder(folder.id)}
                  title={folder.rowTitle ?? `${folder.name}: ${folder.description}`}
                >
                  <span className={`${styles.treeIcon} ${styles.virtualIcon}`} aria-hidden>
                    {folder.icon}
                  </span>
                  <span className={`${styles.treeName} ${folder.emphasize ? styles.treeNameUnread : ""}`}>
                    <span className={styles.treeNameText}>{folder.name}</span>
                  </span>
                  {typeof folder.count === "number" && folder.count > 0 ? (
                    <Badge
                      size="1"
                      variant="soft"
                      color={badgeColors.unread}
                      className={styles.treeUnreadBadge}
                      aria-label={folder.countAriaLabel ?? `${folder.count} unread`}
                      title={folder.countTitle ?? folder.rowTitle}
                    >
                      {folder.countLabel ?? folder.count}
                    </Badge>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          {topSlot}
          <div className={styles.treeHeader}>
            <div>
              <div className={styles.panelTitle}>Folders</div>
              <div className={styles.panelMeta}>{accountFolderCount} total</div>
            </div>
            <div className={styles.treeHeaderActions}>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger>
                  <IconButton
                    variant="ghost"
                    size="1"
                    className={styles.treeAction}
                    title="Folder actions"
                    aria-label="Folder actions"
                  >
                    <MoreVertical size={14} />
                  </IconButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content align="end" className={styles.menuContent}>
                  <DropdownMenu.Item onSelect={() => syncAccount(undefined, "new")}>
                    Sync New Messages
                  </DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => syncAccount(undefined, "full")}>
                    Full Mailbox Sync
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => recomputeThreads()}
                    disabled={isRecomputingThreads}
                  >
                    Recompute Threads
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => recomputeCategories()}
                    disabled={isRecomputingCategories}
                  >
                    Recompute Categories
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Root>
            </div>
          </div>
          <div className={styles.folderSearch}>
            <TextField.Root
              size="2"
              type="search"
              placeholder="Search folders"
              value={folderQuery}
              onChange={(event) => setFolderQuery(event.target.value)}
              id="folder-search-input"
              className={styles.folderSearchInput}
            >
              {folderQuery ? (
                <TextField.Slot side="right">
                  <IconButton
                    size="1"
                    variant="ghost"
                    onClick={() => setFolderQuery("")}
                    aria-label="Clear folder search"
                    title="Clear folder search"
                  >
                    <X size={12} />
                  </IconButton>
                </TextField.Slot>
              ) : null}
            </TextField.Root>
          </div>
          {children}
        </div>
      </div>
    </aside>
  );
}
