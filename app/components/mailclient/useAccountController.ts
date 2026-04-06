"use client";

import type React from "react";
import { useCallback, useEffect } from "react";
import {
  buildAccountFolderDeletePath,
  buildAccountFolderRenamePath,
  buildAccountFoldersCreatePath,
  buildAccountFoldersPath
} from "@/lib/accountApiPaths";
import type { Account, Folder, Message, User } from "@/lib/data";
import type {
  SearchBadgesState,
  SearchFieldsState,
  VirtualFolderDefinition
} from "./useSearchState";
import type { ManageTab } from "../AccountSettingsModal";
import type { SyncJobResult, SyncMode } from "./types";

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type AuthMeResponse = {
  ok?: boolean;
  user?: User | null;
  accountId?: string;
  ttlSeconds?: number;
};

export type UseAccountControllerParams = {
  activeAccountId: string;
  accounts: Account[];
  accountFolders: Folder[];
  activeFolderId: string;
  deletingFolderIds: Set<string>;
  apiFetch: ApiFetch;
  readErrorMessage: (res: Response) => Promise<string>;
  reportError: (message: string) => void;
  refreshFolders: (accountIdOverride?: string) => Promise<Folder[] | null>;
  runSyncJob: (payload: {
    accountId: string;
    folderId?: string;
    fullSync?: boolean;
    mode?: SyncMode;
    fullSyncReason?: string;
  }) => Promise<SyncJobResult>;
  // State setters owned by MailClient
  setAccounts: React.Dispatch<React.SetStateAction<Account[]>>;
  setActiveAccountId: React.Dispatch<React.SetStateAction<string>>;
  setFolders: React.Dispatch<React.SetStateAction<Folder[]>>;
  setAuthState: React.Dispatch<React.SetStateAction<"loading" | "ok" | "unauth">>;
  setCurrentUser: React.Dispatch<React.SetStateAction<User | null>>;
  setInitialDataReady: React.Dispatch<React.SetStateAction<boolean>>;
  setInitialFoldersLoadedAccountId: React.Dispatch<React.SetStateAction<string | null>>;
  setSessionTtlSeconds: React.Dispatch<React.SetStateAction<number | null>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setMessagesPage: React.Dispatch<React.SetStateAction<number>>;
  setHasMoreMessages: React.Dispatch<React.SetStateAction<boolean>>;
  setTotalMessages: React.Dispatch<React.SetStateAction<number | null>>;
  setActiveMessageId: React.Dispatch<React.SetStateAction<string>>;
  setViewMessage: React.Dispatch<React.SetStateAction<Message | null>>;
  setActiveFolderId: React.Dispatch<React.SetStateAction<string>>;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  setSearchScope: React.Dispatch<React.SetStateAction<"folder" | "all">>;
  setSearchFields: React.Dispatch<React.SetStateAction<SearchFieldsState>>;
  setSearchBadges: React.Dispatch<React.SetStateAction<SearchBadgesState>>;
  setActiveVirtualFolderId: React.Dispatch<
    React.SetStateAction<VirtualFolderDefinition["id"] | null>
  >;
  defaultSearchFields: SearchFieldsState;
  defaultSearchBadges: SearchBadgesState;
  setLastFolderId: React.Dispatch<React.SetStateAction<string>>;
  setMessageListError: React.Dispatch<React.SetStateAction<string | null>>;
  setExceptionEntries: React.Dispatch<React.SetStateAction<Array<{ id: string; message: string; timestamp: number }>>>;
  setManageOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setManageTab: React.Dispatch<React.SetStateAction<ManageTab>>;
  setEditingAccount: React.Dispatch<React.SetStateAction<Account | null>>;
  setDeletingFolderIds: React.Dispatch<React.SetStateAction<Set<string>>>;
};

export function useAccountController({
  activeAccountId,
  accounts,
  accountFolders,
  activeFolderId,
  deletingFolderIds,
  apiFetch,
  readErrorMessage,
  reportError,
  refreshFolders,
  runSyncJob,
  setAccounts,
  setActiveAccountId,
  setFolders,
  setAuthState,
  setCurrentUser,
  setInitialDataReady,
  setInitialFoldersLoadedAccountId,
  setSessionTtlSeconds,
  setMessages,
  setMessagesPage,
  setHasMoreMessages,
  setTotalMessages,
  setActiveMessageId,
  setViewMessage,
  setActiveFolderId,
  setQuery,
  setSearchScope,
  setSearchFields,
  setSearchBadges,
  setActiveVirtualFolderId,
  defaultSearchFields,
  defaultSearchBadges,
  setLastFolderId,
  setMessageListError,
  setExceptionEntries,
  setManageOpen,
  setManageTab,
  setEditingAccount,
  setDeletingFolderIds
}: UseAccountControllerParams) {
  const loadInitialData = useCallback(
    async (options?: { skipAuthCheck?: boolean; preferredAccountId?: string | null }) => {
      const skipAuthCheck = options?.skipAuthCheck === true;
      let preferredAccountId = options?.preferredAccountId?.trim() ?? "";
      setInitialDataReady(false);
      setInitialFoldersLoadedAccountId(null);
      try {
        if (!skipAuthCheck) {
          const me = await apiFetch("/api/auth/me", {
            credentials: "include",
            cache: "no-store"
          });
          if (!me.ok) {
            setAuthState("unauth");
            setCurrentUser(null);
            return;
          }
          const meData = (await me.json()) as AuthMeResponse | null;
          setAuthState("ok");
          setCurrentUser(meData?.user ?? null);
          if (typeof meData?.ttlSeconds === "number") {
            setSessionTtlSeconds(meData.ttlSeconds);
          }
          if (typeof meData?.accountId === "string" && meData.accountId.trim()) {
            preferredAccountId = meData.accountId.trim();
          }
        }
        const accountsRes = await apiFetch("/api/accounts");
        let loadedAccounts = false;
        let loadedFolders = false;
        if (accountsRes.ok) {
          const nextAccounts = (await accountsRes.json()) as Account[];
          const resolvedAccountId =
            preferredAccountId &&
            nextAccounts.some((account) => account.id === preferredAccountId)
              ? preferredAccountId
              : nextAccounts.find((account) => account.id === activeAccountId)?.id ??
                nextAccounts[0]?.id ??
                "";
          setAccounts(nextAccounts);
          setActiveAccountId((prev) => {
            if (
              preferredAccountId &&
              nextAccounts.some((account) => account.id === preferredAccountId)
            ) {
              return preferredAccountId;
            }
            if (nextAccounts.find((account) => account.id === prev)) return prev;
            return nextAccounts[0]?.id ?? prev;
          });
          if (resolvedAccountId) {
            const foldersRes = await apiFetch(buildAccountFoldersPath(resolvedAccountId));
            if (foldersRes.ok) {
              const nextFolders = (await foldersRes.json()) as Folder[];
              setFolders(nextFolders);
              setInitialFoldersLoadedAccountId(resolvedAccountId);
              loadedFolders = true;
            } else {
              reportError(await readErrorMessage(foldersRes));
            }
          } else {
            setFolders([]);
            setInitialFoldersLoadedAccountId("");
            loadedFolders = true;
          }
          loadedAccounts = true;
        } else {
          reportError(await readErrorMessage(accountsRes));
        }
        if (loadedAccounts && loadedFolders) {
          setInitialDataReady(true);
        }
      } catch {
        setAuthState("unauth");
        setCurrentUser(null);
        reportError("Failed to load mailbox data.");
      }
    },
    [
      apiFetch,
      activeAccountId,
      readErrorMessage,
      reportError,
      setAccounts,
      setActiveAccountId,
      setAuthState,
      setCurrentUser,
      setFolders,
      setInitialDataReady,
      setInitialFoldersLoadedAccountId,
      setSessionTtlSeconds
    ]
  );

  const switchAccount = useCallback(
    async (nextAccountId: string) => {
      const normalizedAccountId = nextAccountId.trim();
      if (!normalizedAccountId || normalizedAccountId === activeAccountId) return;
      try {
        const response = await apiFetch("/api/auth/switch-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: normalizedAccountId })
        });
        if (!response.ok) {
          reportError(await readErrorMessage(response));
          return;
        }
        const payload = (await response.json().catch(() => null)) as {
          accountId?: string;
        } | null;
        const switchedAccountId =
          typeof payload?.accountId === "string" && payload.accountId.trim()
            ? payload.accountId.trim()
            : normalizedAccountId;
        setExceptionEntries([]);
        setMessageListError(null);
        setMessages([]);
        setMessagesPage(1);
        setHasMoreMessages(true);
        setTotalMessages(null);
        setActiveMessageId("");
        setViewMessage(null);
        setQuery("");
        setSearchScope("folder");
        setSearchFields({ ...defaultSearchFields });
        setSearchBadges({ ...defaultSearchBadges });
        setActiveVirtualFolderId(null);
        setActiveFolderId("");
        setLastFolderId("");
        setActiveAccountId(switchedAccountId);
        await loadInitialData({ skipAuthCheck: true, preferredAccountId: switchedAccountId });
      } catch {
        reportError("Failed to switch account.");
      }
    },
    [
      activeAccountId,
      apiFetch,
      loadInitialData,
      readErrorMessage,
      reportError,
      setActiveAccountId,
      setActiveMessageId,
      setActiveFolderId,
      setActiveVirtualFolderId,
      setExceptionEntries,
      setHasMoreMessages,
      setLastFolderId,
      setMessageListError,
      setMessages,
      setMessagesPage,
      setQuery,
      setSearchBadges,
      setSearchFields,
      setSearchScope,
      setTotalMessages,
      setViewMessage,
      defaultSearchBadges,
      defaultSearchFields
    ]
  );

  const saveAccount = async (account: Account) => {
    if (!account.email?.trim()) {
      reportError("Email address is required");
      return;
    }
    const exists = accounts.find((a) => a.id === account.id);
    const isNew = !exists;
    const accountToSave = isNew ? ({ ...account, id: undefined } as Record<string, unknown>) : account;
    const endpoint = exists ? `/api/accounts/${account.id}` : "/api/accounts";
    const method = exists ? "PUT" : "POST";
    const saveResult = await apiFetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accountToSave)
    });
    if (!saveResult.ok) {
      reportError(await readErrorMessage(saveResult));
      return;
    }
    const newAccountId = isNew
      ? ((await saveResult.json()) as { id: string }).id
      : account.id;
    const refreshed = await apiFetch("/api/accounts");
    if (refreshed.ok) {
      const nextAccounts = (await refreshed.json()) as Account[];
      setAccounts(nextAccounts);
      setManageOpen(false);
      setEditingAccount(null);
      if (isNew) {
        await switchAccount(newAccountId);
        await refreshFolders(newAccountId);
        try {
          await runSyncJob({
            accountId: newAccountId,
            fullSync: true,
            mode: "full",
            fullSyncReason: "Initial sync for a newly created account."
          });
        } catch (error) {
          reportError(
            error instanceof Error
              ? error.message
              : "Initial sync for the new account failed."
          );
        }
      }
    } else {
      reportError(await readErrorMessage(refreshed));
    }
  };

  const saveAccountSettings = async (account: Account) => {
    const exists = accounts.find((a) => a.id === account.id);
    if (!exists) return;
    const caldav = account.caldav?.url?.trim() ? account.caldav : null;
    const res = await apiFetch(`/api/accounts/${account.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: account.settings ?? {},
        caldav
      })
    });
    if (!res.ok) {
      reportError(await readErrorMessage(res));
      return;
    }
    const refreshed = await apiFetch("/api/accounts");
    if (refreshed.ok) {
      const nextAccounts = (await refreshed.json()) as Account[];
      setAccounts(nextAccounts);
      setManageOpen(false);
      setEditingAccount(null);
    } else {
      reportError(await readErrorMessage(refreshed));
    }
  };

  const deleteAccount = async (accountId: string) => {
    const res = await apiFetch(`/api/accounts/${accountId}`, { method: "DELETE" });
    if (!res.ok) {
      reportError(await readErrorMessage(res));
      return;
    }
    const refreshed = await apiFetch("/api/accounts");
    if (refreshed.ok) {
      const nextAccounts = (await refreshed.json()) as Account[];
      setAccounts(nextAccounts);
      const nextAccountId = nextAccounts[0]?.id ?? "";
      if (nextAccountId) {
        await switchAccount(nextAccountId);
      } else {
        setActiveAccountId("");
      }
    } else {
      reportError(await readErrorMessage(refreshed));
    }
    setManageOpen(false);
    setEditingAccount(null);
  };

  const startEditAccount = (account?: Account) => {
    const targetAccount: Account =
      account ?? {
        id: `acc-${crypto.randomUUID().slice(0, 6)}`,
        name: "",
        email: "",
        avatar: "NW",
        imap: { host: "", port: 993, secure: true, user: "", password: "" },
        smtp: { host: "", port: 587, secure: false, user: "", password: "" }
      };
    setEditingAccount(targetAccount);
    setManageOpen(true);
    setManageTab("account");
  };

  const handleCreateSubfolder = async (folder: Folder) => {
    if (!activeAccountId) return;
    const name = window.prompt("New subfolder name");
    if (!name?.trim()) return;
    try {
      const res = await apiFetch(buildAccountFoldersCreatePath(activeAccountId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          parentId: folder.id
        })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      await refreshFolders();
    } catch {
      reportError("Failed to create folder.");
    }
  };

  const handleRenameFolderItem = async (folder: Folder) => {
    if (!activeAccountId) return;
    const name = window.prompt("Rename folder", folder.name);
    if (!name?.trim() || name.trim() === folder.name) return;
    try {
      const res = await apiFetch(buildAccountFolderRenamePath(activeAccountId, folder.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() })
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      await refreshFolders();
    } catch {
      reportError("Failed to rename folder.");
    }
  };

  const handleDeleteFolderItem = async (folder: Folder) => {
    if (!activeAccountId) return;
    if (deletingFolderIds.has(folder.id)) return;
    const confirmed = window.confirm(`Delete folder "${folder.name}" and its messages?`);
    if (!confirmed) return;
    setDeletingFolderIds((prev) => {
      const next = new Set(prev);
      next.add(folder.id);
      return next;
    });
    try {
      const res = await apiFetch(buildAccountFolderDeletePath(activeAccountId, folder.id), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (!res.ok) {
        reportError(await readErrorMessage(res));
        return;
      }
      await refreshFolders();
      if (activeFolderId === folder.id) {
        setActiveFolderId(accountFolders[0]?.id ?? "");
      }
    } catch {
      reportError("Failed to delete folder.");
    } finally {
      setDeletingFolderIds((prev) => {
        const next = new Set(prev);
        next.delete(folder.id);
        return next;
      });
    }
  };

  // Load initial data on mount
  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  return {
    loadInitialData,
    switchAccount,
    refreshFolders,
    saveAccount,
    saveAccountSettings,
    deleteAccount,
    startEditAccount,
    handleCreateSubfolder,
    handleRenameFolderItem,
    handleDeleteFolderItem
  };
}
