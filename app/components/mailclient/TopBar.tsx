import Image from "next/image";

import type React from "react";
import { Edit3, FileText, Moon, RefreshCw, Settings, Sun, Trash2, X } from "lucide-react";
import { Badge, Button, DropdownMenu, IconButton, Select, TextField } from "@radix-ui/themes";
import { badgeColors } from "@/lib/ui/badgeColors";
import type { Account, Folder, Message } from "@/lib/data";
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
  flagged: boolean;
  todo: boolean;
  pinned: boolean;
  attachments: boolean;
};

type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew";

type TopBarProps = {
  state: {
    query: string;
    searchScope: "folder" | "all";
    searchFields: SearchFields;
    searchBadges: SearchBadges;
    darkMode: boolean;
    isRelatedSearch: boolean;
    accounts: Account[];
    currentAccount: Account | null;
    messages: Message[];
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
    setSearchFields: React.Dispatch<React.SetStateAction<SearchFields>>;
    setSearchBadges: React.Dispatch<React.SetStateAction<SearchBadges>>;
    clearSearch: () => void;
    toggleDarkMode: () => void;
    openCompose: (mode: ComposeMode) => void;
    setActiveFolderId: React.Dispatch<React.SetStateAction<string>>;
    setLastFolderId: React.Dispatch<React.SetStateAction<string>>;
    setActiveMessageId: React.Dispatch<React.SetStateAction<string>>;
    startEditAccount: (account?: Account) => void;
    deleteAccount: (accountId: string) => void;
    setActiveAccountId: React.Dispatch<React.SetStateAction<string>>;
    syncAccount: (folderId?: string, mode?: "new" | "full") => void;
  };
};

export default function TopBar({ state, ui, actions }: TopBarProps) {
  const {
    query,
    searchScope,
    searchFields,
    searchBadges,
    darkMode,
    isRelatedSearch,
    accounts,
    currentAccount,
    messages,
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
    setSearchFields,
    setSearchBadges,
    clearSearch,
    toggleDarkMode,
    openCompose,
    setActiveFolderId,
    setLastFolderId,
    setActiveMessageId,
    startEditAccount,
    deleteAccount,
    setActiveAccountId,
    syncAccount
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
    setActiveAccountId(accountId);
    setActiveMessageId(
      messages.find((message) => message.accountId === accountId)?.id ?? messages[0]?.id ?? ""
    );
  };

  return (
    <header className={styles.topBar}>
      <div className={styles.brand}>
        <div className={styles.brandMark} aria-hidden>
          <Image
            className={styles.brandIcon}
            src="/icon.png"
            alt=""
            width={44}
            height={44}
            quality={85}
            priority
          />
        </div>
        <h1 className={styles.brandTitle}>Noctua Mail</h1>
      </div>
      <div className={styles.search}>
        <div className={styles.searchPrimary}>
          <TextField.Root
            size="2"
            type="search"
            placeholder="Search all messages"
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
                  onClick={() => setQuery("")}
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
          <Select.Root
            size="2"
            value={searchScope}
            disabled={isRelatedSearch}
            onValueChange={handleScopeChange}
          >
            <Select.Trigger className={styles.select} color="gray" variant="surface" />
            <Select.Content position="popper">
              <Select.Item value="folder">Current folder</Select.Item>
              <Select.Item value="all">Everywhere</Select.Item>
            </Select.Content>
          </Select.Root>
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
                {searchFieldsLabel}
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Label>Search in</DropdownMenu.Label>
              <DropdownMenu.Separator />
              {(
                [
                  ["sender", "Sender"],
                  ["participants", "Participants"],
                  ["subject", "Subject"],
                  ["body", "Body"],
                  ["attachments", "Attachments"]
                ] as const
              ).map(([key, label]) => (
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
                  {label}
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
                {searchBadgesLabel}
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              <DropdownMenu.Label>Badges</DropdownMenu.Label>
              <DropdownMenu.Separator />
              {(
                [
                  ["unread", "Unread"],
                  ["flagged", "Flagged"],
                  ["todo", "To-Do"],
                  ["pinned", "Pinned"],
                  ["attachments", "Attachments"]
                ] as const
              ).map(([key, label]) => (
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
                  {label}
                </DropdownMenu.CheckboxItem>
              ))}
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
