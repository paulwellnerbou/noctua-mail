import type React from "react";
import { MoreVertical } from "lucide-react";
type FolderPaneProps = {
  state: {
    leftWidth: number;
    folderQuery: string;
    accountFolderCount: number;
    folderHeaderMenuOpen: boolean;
    isRecomputingThreads: boolean;
  };
  actions: {
    setFolderQuery: React.Dispatch<React.SetStateAction<string>>;
    setFolderHeaderMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
    syncAccount: (folderId?: string, mode?: "new" | "full") => void;
    recomputeThreads: () => void;
  };
  refs: {
    folderHeaderMenuRef: React.RefObject<HTMLDivElement | null>;
  };
  children?: React.ReactNode;
};

export default function FolderPane({ state, actions, refs, children }: FolderPaneProps) {
  const {
    leftWidth,
    folderQuery,
    accountFolderCount,
    folderHeaderMenuOpen,
    isRecomputingThreads
  } = state;
  const { setFolderQuery, setFolderHeaderMenuOpen, syncAccount, recomputeThreads } = actions;
  const { folderHeaderMenuRef } = refs;

  return (
    <aside className="pane" style={{ width: leftWidth }}>
      <div className="folder-panel">
        <div className="tree-rail">
          <div className="tree-header">
            <div>
              <div className="panel-title">Folders</div>
              <div className="panel-meta">{accountFolderCount} total</div>
            </div>
            <div className="tree-header-actions">
              <div
                className="message-menu folder-header-menu"
                ref={folderHeaderMenuOpen ? folderHeaderMenuRef : null}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  className="tree-action"
                  title="Folder actions"
                  aria-label="Folder actions"
                  onClick={(event) => {
                    event.stopPropagation();
                    setFolderHeaderMenuOpen((prev) => !prev);
                  }}
                >
                  <MoreVertical size={14} />
                </button>
                {folderHeaderMenuOpen && (
                  <div className="message-menu-panel">
                    <button
                      className="message-menu-item"
                      onClick={() => {
                        setFolderHeaderMenuOpen(false);
                        syncAccount(undefined, "full");
                      }}
                    >
                      Sync Folders
                    </button>
                    <button
                      className="message-menu-item"
                      onClick={() => {
                        setFolderHeaderMenuOpen(false);
                        recomputeThreads();
                      }}
                      disabled={isRecomputingThreads}
                    >
                      Recompute Threads
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="folder-search">
            <input
              type="search"
              placeholder="Search folders"
              value={folderQuery}
              onChange={(event) => setFolderQuery(event.target.value)}
            />
          </div>
          {children}
        </div>
      </div>
    </aside>
  );
}
