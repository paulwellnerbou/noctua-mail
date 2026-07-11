"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Folder as FolderIcon, Check } from "lucide-react";
import { Dialog, IconButton, TextField } from "@radix-ui/themes";
import type { Folder } from "@/lib/data";
import { buildAccountDestinationFoldersPath } from "@/lib/accountApiPaths";
import FolderPickerNode from "../folder/FolderPickerNode";
import { buildFolderTree } from "../utils/folderHelpers";
import { folderSpecialIcon } from "../RenderHelpers";
import styles from "./MoveToDialog.module.css";

export type CopyToAccountTarget = {
  id: string;
  name?: string;
  email?: string;
};

type CopyToAccountDialogProps = {
  open: boolean;
  mode: "copy" | "move";
  messageCount: number;
  accounts: CopyToAccountTarget[];
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onOpenChange: (open: boolean) => void;
  onConfirm: (destinationAccountId: string, destinationFolderId: string) => void;
};

function accountLabel(account: CopyToAccountTarget) {
  return account.name?.trim() || account.email?.trim() || account.id;
}

export default function CopyToAccountDialog({
  open,
  mode,
  messageCount,
  accounts,
  apiFetch,
  onOpenChange,
  onConfirm
}: CopyToAccountDialogProps) {
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Reset selection whenever the dialog is (re)opened.
  useEffect(() => {
    if (!open) return;
    setSelectedAccountId(accounts[0]?.id ?? "");
    setQuery("");
    setCollapsedFolders({});
    setError(null);
  }, [open, accounts]);

  useEffect(() => {
    if (!open || !selectedAccountId) {
      setFolders([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(buildAccountDestinationFoldersPath(selectedAccountId))
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load folders (${res.status})`);
        return (await res.json()) as Folder[];
      })
      .then((data) => {
        if (cancelled) return;
        setFolders(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (cancelled) return;
        setFolders([]);
        setError("Could not load folders for this account.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedAccountId, apiFetch]);

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders]
  );
  const rootFolders = useMemo(() => folders.filter((folder) => !folder.parentId), [folders]);

  const folderQueryText = query.trim().toLowerCase();

  const hasFolderMatch = useCallback(
    function match(folder: Folder): boolean {
      if (!folderQueryText) return true;
      if (folder.name.toLowerCase().includes(folderQueryText)) return true;
      const children = folderTree.get(folder.id) ?? [];
      return children.some((child) => match(child));
    },
    [folderQueryText, folderTree]
  );

  const onToggleCollapse = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  }, []);

  const handleSelectFolder = useCallback(
    (folderId: string) => {
      if (!selectedAccountId) return;
      onConfirm(selectedAccountId, folderId);
      onOpenChange(false);
    },
    [selectedAccountId, onConfirm, onOpenChange]
  );

  const hasNoResults =
    folderQueryText.length > 0 && !rootFolders.some((folder) => hasFolderMatch(folder));

  const verb = mode === "move" ? "Move" : "Copy";
  const title = `${verb} ${messageCount === 1 ? "message" : `${messageCount} messages`} to account`;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        className={styles.dialogContent}
        aria-label={title}
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchInputRef.current?.focus();
        }}
      >
        <div className={styles.dialogHeader}>
          <Dialog.Title className={styles.dialogTitle}>{title}</Dialog.Title>
          <Dialog.Close>
            <IconButton variant="ghost" size="1" aria-label="Close">
              <X size={14} />
            </IconButton>
          </Dialog.Close>
        </div>

        <div className={styles.recentSection} style={{ padding: "8px 6px 8px" }}>
          <div className={styles.sectionLabel}>Account</div>
          {accounts.map((account) => {
            const selected = account.id === selectedAccountId;
            return (
              <button
                key={account.id}
                type="button"
                className={styles.recentRow}
                aria-pressed={selected}
                onClick={() => setSelectedAccountId(account.id)}
                style={selected ? { background: "var(--accent-a3)" } : undefined}
              >
                <span className={styles.recentIcon} aria-hidden>
                  {selected ? <Check size={14} /> : <FolderIcon size={14} />}
                </span>
                {accountLabel(account)}
              </button>
            );
          })}
        </div>

        <div className={styles.searchArea}>
          <TextField.Root
            ref={searchInputRef}
            size="2"
            type="search"
            placeholder="Search folders"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
          <div className={styles.folderSection}>
            {!folderQueryText && <div className={styles.sectionLabel}>Folders</div>}
            {loading ? (
              <div className={styles.emptyState}>Loading folders…</div>
            ) : error ? (
              <div className={styles.emptyState}>{error}</div>
            ) : hasNoResults ? (
              <div className={styles.emptyState}>No folders match &ldquo;{query}&rdquo;</div>
            ) : rootFolders.length === 0 ? (
              <div className={styles.emptyState}>No folders available.</div>
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
                  onSelectFolder={handleSelectFolder}
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
