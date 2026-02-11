import type React from "react";
import { MoreVertical } from "lucide-react";
import { DropdownMenu, IconButton, TextField } from "@radix-ui/themes";
import styles from "./FolderTree.module.css";
type FolderPaneProps = {
  state: {
    leftWidth: number;
    folderQuery: string;
    accountFolderCount: number;
    isRecomputingThreads: boolean;
    isRecomputingCategories: boolean;
  };
  actions: {
    setFolderQuery: React.Dispatch<React.SetStateAction<string>>;
    syncAccount: (folderId?: string, mode?: "new" | "full") => void;
    recomputeThreads: () => void;
    recomputeCategories: () => void;
  };
  children?: React.ReactNode;
};

export default function FolderPane({ state, actions, children }: FolderPaneProps) {
  const { leftWidth, folderQuery, accountFolderCount, isRecomputingThreads, isRecomputingCategories } = state;
  const { setFolderQuery, syncAccount, recomputeThreads, recomputeCategories } = actions;

  return (
    <aside className={`pane ${styles.pane}`} style={{ width: leftWidth }}>
      <div className={styles.folderPanel}>
        <div className={styles.treeRail}>
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
            />
          </div>
          {children}
        </div>
      </div>
    </aside>
  );
}
