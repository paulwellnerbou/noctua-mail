import Image from "next/image";

import type React from "react";
import { Edit3, FileText, Moon, RefreshCw, Settings, Sun, Trash2, X } from "lucide-react";
import type { Account, Folder, Message } from "@/lib/data";

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
    searchFieldsOpen: boolean;
    searchBadgesOpen: boolean;
    darkMode: boolean;
    accounts: Account[];
    currentAccount: Account | null;
    messages: Message[];
    draftsFolder?: Folder | null;
    draftsCount: number;
    activeFolderId: string;
    lastFolderId: string;
    accountFolders: Folder[];
    menuOpen: boolean;
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
    setSearchFieldsOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setSearchBadgesOpen: React.Dispatch<React.SetStateAction<boolean>>;
    toggleDarkMode: () => void;
    openCompose: (mode: ComposeMode) => void;
    setActiveFolderId: React.Dispatch<React.SetStateAction<string>>;
    setLastFolderId: React.Dispatch<React.SetStateAction<string>>;
    setActiveMessageId: React.Dispatch<React.SetStateAction<string>>;
    startEditAccount: (account?: Account) => void;
    deleteAccount: (accountId: string) => void;
    setActiveAccountId: React.Dispatch<React.SetStateAction<string>>;
    setMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
    syncAccount: (folderId?: string, mode?: "new" | "full") => void;
  };
  refs: {
    menuRef: React.RefObject<HTMLDivElement | null>;
    searchFieldsRef: React.RefObject<HTMLDivElement | null>;
    searchBadgesRef: React.RefObject<HTMLDivElement | null>;
  };
};

export default function TopBar({ state, ui, actions, refs }: TopBarProps) {
  const {
    query,
    searchScope,
    searchFields,
    searchBadges,
    searchFieldsOpen,
    searchBadgesOpen,
    darkMode,
    accounts,
    currentAccount,
    messages,
    draftsFolder,
    draftsCount,
    activeFolderId,
    lastFolderId,
    accountFolders,
    menuOpen,
    isSyncing
  } = state;
  const {
    setQuery,
    setSearchScope,
    setSearchFields,
    setSearchBadges,
    setSearchFieldsOpen,
    setSearchBadgesOpen,
    toggleDarkMode,
    openCompose,
    setActiveFolderId,
    setLastFolderId,
    setActiveMessageId,
    startEditAccount,
    deleteAccount,
    setActiveAccountId,
    setMenuOpen,
    syncAccount
  } = actions;
  const { searchFieldsLabel, searchBadgesLabel } = ui;
  const { menuRef, searchFieldsRef, searchBadgesRef } = refs;

  return (
    <header className="top-bar">
      <div className="brand">
        <div className="brand-mark" aria-hidden>
          <Image
            className="brand-icon"
            src="/icon.png"
            alt=""
            width={44}
            height={44}
            quality={85}
            priority
          />
        </div>
        <h1>Noctua Mail</h1>
      </div>
      <div className="search-bar">
        <input
          type="search"
          placeholder="Search all messages"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="search-controls">
          {query && (
            <button
              className="search-control search-clear"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
          <select
            className="search-control"
            value={searchScope}
            onChange={(event) => {
              const next = event.target.value as "folder" | "all";
              setSearchScope(next);
              if (next === "all") {
                setLastFolderId(activeFolderId);
                setActiveFolderId("");
              } else {
                setActiveFolderId(lastFolderId || accountFolders[0]?.id || "");
              }
            }}
          >
            <option value="folder">Current folder</option>
            <option value="all">Everywhere</option>
          </select>
          <div className="search-fields" ref={searchFieldsRef}>
            <button
              className="search-control"
              onClick={() => setSearchFieldsOpen((open) => !open)}
              aria-label="Search fields"
              title="Search fields"
            >
              {searchFieldsLabel}
            </button>
            {searchFieldsOpen && (
              <div className="search-fields-panel">
                <div className="search-fields-title">Search in</div>
                <div className="search-fields-grid">
                  {(
                    [
                      ["sender", "Sender"],
                      ["participants", "Participants"],
                      ["subject", "Subject"],
                      ["body", "Body"],
                      ["attachments", "Attachments"]
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="search-field-option">
                      <span className="search-field-label">{label}</span>
                      <input
                        type="checkbox"
                        checked={searchFields[key]}
                        disabled={key === "sender" && searchFields.participants}
                        onChange={(event) =>
                          setSearchFields((prev) => ({
                            ...prev,
                            [key]: event.target.checked,
                            ...(key === "participants" && event.target.checked
                              ? { sender: false }
                              : {})
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="search-fields" ref={searchBadgesRef}>
            <button
              className="search-control"
              onClick={() => setSearchBadgesOpen((open) => !open)}
              aria-label="Search badges"
              title="Search badges"
            >
              {searchBadgesLabel}
            </button>
            {searchBadgesOpen && (
              <div className="search-fields-panel">
                <div className="search-fields-title">Badges</div>
                <div className="search-fields-grid">
                  {(
                    [
                      ["unread", "Unread"],
                      ["flagged", "Flagged"],
                      ["todo", "To-Do"],
                      ["pinned", "Pinned"],
                      ["attachments", "Attachments"]
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="search-field-option">
                      <span className="search-field-label">{label}</span>
                      <input
                        type="checkbox"
                        checked={searchBadges[key]}
                        onChange={(event) =>
                          setSearchBadges((prev) => ({
                            ...prev,
                            [key]: event.target.checked
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="action-row">
        <button
          className="icon-button new-mail-button"
          onClick={() => openCompose("new")}
          title="New mail"
          aria-label="New mail"
        >
          <Edit3 size={14} />
          New Mail
        </button>
        {draftsFolder && draftsCount > 0 && (
          <button
            className="icon-button drafts-button"
            onClick={() => {
              setSearchScope("folder");
              setActiveFolderId(draftsFolder.id);
              setActiveMessageId("");
            }}
            title="Open drafts folder"
            aria-label="Open drafts folder"
          >
            <FileText size={14} />
            {`${draftsCount} Draft${draftsCount === 1 ? "" : "s"}`}
          </button>
        )}
        <button
          className="icon-button"
          onClick={toggleDarkMode}
          title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          {darkMode ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button
          className="icon-button"
          onClick={() => syncAccount(undefined, "new")}
          disabled={isSyncing}
          aria-label="Check new mail"
          title="Check for new mail"
        >
          <RefreshCw size={18} className={isSyncing ? "spin" : ""} />
        </button>
        <div className="user-menu" ref={menuRef}>
          <button className="icon-button" onClick={() => setMenuOpen((open) => !open)}>
            {currentAccount?.name ? `${currentAccount.name} ` : ""}
            {currentAccount?.email ? (
              <span className="account-email">&lt;{currentAccount.email}&gt;</span>
            ) : null}
          </button>
          {menuOpen && (
            <div className="user-menu-panel">
              <h4>Accounts</h4>
              {accounts.map((account) => (
                <div key={account.id} className="user-menu-item">
                  <div
                    className="user-menu-select"
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setActiveAccountId(account.id);
                      setActiveMessageId(
                        messages.find((m) => m.accountId === account.id)?.id ??
                          messages[0]?.id ??
                          ""
                      );
                      setMenuOpen(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setActiveAccountId(account.id);
                        setActiveMessageId(
                          messages.find((m) => m.accountId === account.id)?.id ??
                            messages[0]?.id ??
                            ""
                        );
                        setMenuOpen(false);
                      }
                    }}
                  >
                    <span className="badge">{account.email}</span>
                    <span className="menu-account">
                      {account.name}
                      <span>{account.email}</span>
                    </span>
                    <button
                      className="icon-button menu-gear"
                      onClick={(event) => {
                        event.stopPropagation();
                        startEditAccount(account);
                        setMenuOpen(false);
                      }}
                      title="Account settings"
                      aria-label="Account settings"
                    >
                      <Settings size={14} />
                    </button>
                    <button
                      className="icon-button menu-delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteAccount(account.id);
                      }}
                      title="Delete account"
                      aria-label="Delete account"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
              <button className="icon-button" onClick={() => startEditAccount()}>
                + Add account
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
