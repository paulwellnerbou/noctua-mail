import type React from "react";
import {
  CheckSquare2,
  ChevronDown,
  Circle,
  CircleDot,
  Edit3,
  FileText,
  Folder as FolderIcon,
  LogOut,
  Moon,
  RefreshCw,
  Settings,
  Sparkles,
  Square,
  Sun,
  Trash2,
  X
} from "lucide-react";
import { Badge, Button, DropdownMenu, IconButton, TextField } from "@radix-ui/themes";
import { badgeColors } from "@/lib/ui/badgeColors";
import { SEARCH_BADGE_OPTIONS, SEARCH_FIELD_OPTIONS } from "@/lib/ui/searchFilters";
import type { Account, Folder } from "@/lib/data";
import type { SyncTriggerOptions } from "./types";
import styles from "./TopBar.module.css";

type SearchFields = {
  sender: boolean;
  participants: boolean;
  subject: boolean;
  body: boolean;
  attachments: boolean;
};

type SearchBadges = {
  unread: boolean;
  unanswered: boolean;
  flagged: boolean;
  todo: boolean;
  calendar: boolean;
  attachments: boolean;
  newsletter: boolean;
  notification: boolean;
  transactional: boolean;
  "ai-modified": boolean;
};

type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew";

type TopBarProps = {
  buildVersionLabel?: string;
  state: {
    query: string;
    searchScope: "folder" | "all";
    includeSentInEverywhere: boolean;
    sentFolderName: string | null;
    searchFields: SearchFields;
    searchBadges: SearchBadges;
    darkMode: boolean;
    isRelatedSearch: boolean;
    accounts: Account[];
    currentAccount: Account | null;
    draftsFolder?: Folder | null;
    draftsCount: number;
    activeFolderId: string;
    lastFolderId: string;
    accountFolders: Folder[];
    isSyncing: boolean;
  };
  ui: {
    searchFieldsLabel: string;
    searchBadgesLabel: string;
  };
  actions: {
    setQuery: React.Dispatch<React.SetStateAction<string>>;
    setSearchScope: React.Dispatch<React.SetStateAction<"folder" | "all">>;
    setIncludeSentInEverywhere: React.Dispatch<React.SetStateAction<boolean>>;
    setSearchFields: React.Dispatch<React.SetStateAction<SearchFields>>;
    setSearchBadges: React.Dispatch<React.SetStateAction<SearchBadges>>;
    clearSearch: () => void;
    toggleDarkMode: () => void;
    openCompose: (mode: ComposeMode) => void;
    setActiveFolderId: React.Dispatch<React.SetStateAction<string>>;
    setLastFolderId: React.Dispatch<React.SetStateAction<string>>;
    startEditAccount: (account?: Account) => void;
    deleteAccount: (accountId: string) => void;
    switchAccount: (accountId: string) => void;
    syncAccount: (
      folderId?: string,
      mode?: "new" | "full",
      options?: SyncTriggerOptions
    ) => void;
    logout: () => void;
  };
};

export default function TopBar({
  buildVersionLabel = "",
  state,
  ui,
  actions
}: TopBarProps) {
  const {
    query,
    searchScope,
    includeSentInEverywhere,
    sentFolderName,
    searchFields,
    searchBadges,
    darkMode,
    isRelatedSearch,
    accounts,
    currentAccount,
    draftsFolder,
    draftsCount,
    activeFolderId,
    lastFolderId,
    accountFolders,
    isSyncing
  } = state;
  const {
    setQuery,
    setSearchScope,
    setIncludeSentInEverywhere,
    setSearchFields,
    setSearchBadges,
    clearSearch,
    toggleDarkMode,
    openCompose,
    setActiveFolderId,
    setLastFolderId,
    startEditAccount,
    deleteAccount,
    switchAccount,
    syncAccount,
    logout
  } = actions;
  const { searchFieldsLabel, searchBadgesLabel } = ui;

  const handleScopeChange = (next: string) => {
    const nextScope = next as "folder" | "all";
    setSearchScope(nextScope);
    if (nextScope === "all") {
      setLastFolderId(activeFolderId);
      setActiveFolderId("");
    } else {
      setActiveFolderId(lastFolderId || accountFolders[0]?.id || "");
    }
  };

  const handleAccountChange = (accountId: string) => {
    if (!accountId) return;
    switchAccount(accountId);
  };
  const scopeLabel = searchScope === "all" ? "Everywhere" : "Current folder";
  const folderById = new Map(accountFolders.map((folder) => [folder.id, folder]));
  const currentFolderId =
    searchScope === "folder" ? activeFolderId : lastFolderId || accountFolders[0]?.id || "";
  const currentFolder = currentFolderId ? folderById.get(currentFolderId) ?? null : null;
  const currentFolderPath = (() => {
    if (!currentFolder) return "";
    const parts = [currentFolder.name];
    let parentId = currentFolder.parentId ?? null;
    while (parentId) {
      const parent = folderById.get(parentId);
      if (!parent) break;
      parts.unshift(parent.name);
      parentId = parent.parentId ?? null;
    }
    return parts.join("/");
  })();
  const menuCheckboxLabel = (
    checked: boolean,
    label: React.ReactNode,
    options?: { indented?: boolean }
  ) => (
    <span
      className={`${styles.menuCheckboxLabel}${options?.indented ? ` ${styles.menuCheckboxLabelIndented}` : ""}`}
    >
      <span className={styles.menuCheckboxIcon} aria-hidden>
        {checked ? <CheckSquare2 size={14} /> : <Square size={14} />}
      </span>
      {label}
    </span>
  );

  const menuRadioLabel = (checked: boolean, label: string) => (
    <span className={styles.menuCheckboxLabel}>
      <span className={styles.menuCheckboxIcon} aria-hidden>
        {checked ? <CircleDot size={14} /> : <Circle size={14} />}
      </span>
      {label}
    </span>
  );
  const aiModifiedBadgeLabel = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem" }}>
      <Sparkles size={14} />
      AI Modified
    </span>
  );

  return (
    <header className={styles.topBar}>
      <div className={styles.brand}>
        <div className={styles.brandMark} aria-hidden>
          {/* Vector logo with the env ribbon, rendered server-side from
              APP_ENV_LABEL. Plain <img> (not next/image) to serve the SVG
              unoptimized so it stays crisp at any size. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className={styles.brandIcon}
            src="/icons/logo.svg"
            alt=""
            width={44}
            height={44}
          />
        </div>
        <div className={styles.brandText}>
          <div className={styles.brandTitleWrap}>
            <h1 className={styles.brandTitle}>Noctua Mail</h1>
          </div>
          {buildVersionLabel ? (
            <div className={styles.brandVersion} title={`Build ${buildVersionLabel}`}>
              {buildVersionLabel}
            </div>
          ) : null}
        </div>
      </div>
      <div className={styles.search}>
        <div className={styles.searchPrimary}>
          <TextField.Root
            size="2"
            type="search"
            placeholder={
              searchScope === "all"
                ? "Search messages everywhere"
                : currentFolder
                  ? `Search messages in ${currentFolder.name}`
                  : "Search messages"
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            id="top-search-input"
            className={styles.searchInput}
          >
            {query ? (
              <TextField.Slot side="right">
                <IconButton
                  size="1"
                  variant="ghost"
                  onClick={() => (isRelatedSearch ? clearSearch() : setQuery(""))}
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <X size={12} />
                </IconButton>
              </TextField.Slot>
            ) : null}
          </TextField.Root>
        </div>
        <div className={styles.searchFilters}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button
                size="2"
                variant="surface"
                color="gray"
                disabled={isRelatedSearch}
                className={`${styles.select} ${styles.scopeButton}`}
                title={scopeLabel}
              >
                {scopeLabel}
                <ChevronDown size={14} />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content className={styles.searchMenuContent}>
              <DropdownMenu.RadioGroup value={searchScope} onValueChange={handleScopeChange}>
                <DropdownMenu.RadioItem value="folder">
                  <span className={styles.scopeMenuRow}>
                    {menuCheckboxLabel(searchScope === "folder", "Current folder:")}
                    {currentFolder ? (
                      <Badge size="1" variant="soft" color={badgeColors.folder}>
                        <span className={styles.scopeFolderBadge} title={currentFolderPath}>
                          <FolderIcon size={12} />
                          {currentFolder.name}
                        </span>
                      </Badge>
                    ) : null}
                  </span>
                </DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="all">
                  {menuCheckboxLabel(searchScope === "all", "Everywhere")}
                </DropdownMenu.RadioItem>
              </DropdownMenu.RadioGroup>
              {sentFolderName ? (
                <DropdownMenu.CheckboxItem
                  checked={includeSentInEverywhere}
                  disabled={searchScope !== "all"}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) => setIncludeSentInEverywhere(checked === true)}
                >
                  {menuCheckboxLabel(includeSentInEverywhere, `Include ${sentFolderName}`, {
                    indented: true
                  })}
                </DropdownMenu.CheckboxItem>
              ) : null}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button
                size="2"
                variant="surface"
                color="gray"
                disabled={isRelatedSearch}
                className={styles.filterButton}
                title={searchFieldsLabel}
              >
                <span className={styles.filterButtonLabel}>{searchFieldsLabel}</span>
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content className={styles.searchMenuContent}>
              <DropdownMenu.Label>Search in</DropdownMenu.Label>
              <DropdownMenu.Separator />
              {SEARCH_FIELD_OPTIONS.map(([key, label]) => (
                <DropdownMenu.CheckboxItem
                  key={key}
                  checked={searchFields[key]}
                  disabled={key === "sender" && searchFields.participants}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    setSearchFields((prev) => ({
                      ...prev,
                      [key]: checked === true,
                      ...(key === "participants" && checked === true ? { sender: false } : {})
                    }))
                  }
                >
                  {menuCheckboxLabel(searchFields[key], label)}
                </DropdownMenu.CheckboxItem>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button
                size="2"
                variant="surface"
                color="gray"
                disabled={isRelatedSearch}
                className={styles.filterButton}
                title={searchBadgesLabel}
              >
                <span className={styles.filterButtonLabel}>{searchBadgesLabel}</span>
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content className={styles.searchMenuContent}>
              {SEARCH_BADGE_OPTIONS.filter(([key]) => !["newsletter", "notification", "transactional", "ai-modified"].includes(key)).map(([key, label]) => (
                <DropdownMenu.CheckboxItem
                  key={key}
                  checked={searchBadges[key]}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    setSearchBadges((prev) => ({
                      ...prev,
                      [key]: checked === true
                    }))
                  }
                >
                  {menuCheckboxLabel(searchBadges[key], label)}
                </DropdownMenu.CheckboxItem>
              ))}
              <DropdownMenu.Separator />
              {SEARCH_BADGE_OPTIONS.filter(([key]) => ["newsletter", "notification", "transactional"].includes(key)).map(([key, label]) => {
                const isSelected = searchBadges[key];
                return (
                  <DropdownMenu.Item
                    key={key}
                    onSelect={(event) => {
                      event.preventDefault();
                      // Toggle selection or switch to this category
                      setSearchBadges((prev) => ({
                        ...prev,
                        newsletter: key === "newsletter" ? !prev.newsletter : false,
                        notification: key === "notification" ? !prev.notification : false,
                        transactional: key === "transactional" ? !prev.transactional : false
                      }));
                    }}
                  >
                    {menuRadioLabel(isSelected, label)}
                  </DropdownMenu.Item>
                );
              })}
              <DropdownMenu.Separator />
              <DropdownMenu.Label>AI</DropdownMenu.Label>
              <DropdownMenu.Separator />
              <DropdownMenu.CheckboxItem
                checked={searchBadges["ai-modified"]}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) =>
                  setSearchBadges((prev) => ({
                    ...prev,
                    "ai-modified": checked === true
                  }))
                }
              >
                {menuCheckboxLabel(searchBadges["ai-modified"], aiModifiedBadgeLabel)}
              </DropdownMenu.CheckboxItem>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
      </div>
      <div className={styles.actionRow}>
        <div className={styles.actionGroup}>
          <Button
            size="2"
            onClick={() => openCompose("new")}
            title="New mail"
            aria-label="New mail"
          >
            <Edit3 size={14} />
            New Mail
          </Button>
          {draftsFolder && draftsCount > 0 && (
            <Button
              size="2"
              variant="surface"
              onClick={() => {
                clearSearch();
                setSearchScope("folder");
                setActiveFolderId(draftsFolder.id);
              }}
              title="Open drafts folder"
              aria-label="Open drafts folder"
            >
              <FileText size={14} />
              {`${draftsCount} Draft${draftsCount === 1 ? "" : "s"}`}
            </Button>
          )}
          <IconButton
            size="2"
            variant="surface"
            onClick={() => syncAccount(undefined, "new")}
            disabled={isSyncing}
            aria-label="Check new mail"
            title="Check for new mail"
          >
            <RefreshCw size={18} className={isSyncing ? styles.spin : undefined} />
          </IconButton>
        </div>

        <div className={styles.accountSlot}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button size="2" variant="surface" className={styles.accountButton}>
                <span className={styles.accountMeta}>
                  <span className={styles.accountName}>
                    {currentAccount?.name ?? currentAccount?.email ?? "Account"}
                  </span>
                  {currentAccount?.name && currentAccount?.email ? (
                    <span className={styles.accountEmail}>{currentAccount.email}</span>
                  ) : null}
                </span>
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content className={styles.accountMenu}>
              <DropdownMenu.Label>Accounts</DropdownMenu.Label>
              <DropdownMenu.Separator />
              {accounts.length ? (
                <DropdownMenu.RadioGroup
                  value={currentAccount?.id ?? ""}
                  onValueChange={handleAccountChange}
                >
                  {accounts.map((account) => (
                    <DropdownMenu.RadioItem
                      key={account.id}
                      value={account.id}
                      className={styles.accountMenuItem}
                    >
                      <div className={styles.accountMenuInfo}>
                        <span className={styles.accountMenuName}>
                          {account.name || account.email}
                        </span>
                        {account.name && account.email ? (
                          <span className={styles.accountMenuEmail}>{account.email}</span>
                        ) : null}
                      </div>
                      {account.name && account.email ? (
                        <Badge size="1" variant="soft" color={badgeColors.folder}>
                          {account.email}
                        </Badge>
                      ) : null}
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              ) : (
                <DropdownMenu.Item disabled>No accounts</DropdownMenu.Item>
              )}
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                disabled={!currentAccount}
                onSelect={() => (currentAccount ? startEditAccount(currentAccount) : null)}
              >
                <Settings size={14} />
                Account settings
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled={!currentAccount}
                onSelect={() => (currentAccount ? deleteAccount(currentAccount.id) : null)}
              >
                <Trash2 size={14} />
                Delete account
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onSelect={() => startEditAccount()}>+ Add account</DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onSelect={logout}>
                <LogOut size={14} />
                Logout
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>

        <div className={`${styles.actionGroup} ${styles.utilitySlot}`}>
          <IconButton
            size="3"
            variant="ghost"
            className={styles.themeButton}
            onClick={toggleDarkMode}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
        </div>
      </div>
    </header>
  );
}
