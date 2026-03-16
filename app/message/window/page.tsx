"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useSearchParams } from "next/navigation";
import { Text } from "@radix-ui/themes";
import { normalizeAccountDateFormat } from "@/lib/dateFormatting";
import type { Account, AccountDateFormat, Folder, Message } from "@/lib/data";
import { notifyDetachedMessageDeleted } from "@/lib/ui/detachedMessageEvents";
import { getImapFlagBadges, hasHtmlContent } from "@/lib/ui/messageView";
import { openDetachedWindow } from "@/lib/ui/openDetachedWindow";
import MessageMenu from "@/app/components/mailclient/message/MessageMenu";
import MessageQuickActions from "@/app/components/mailclient/message/MessageQuickActions";
import MessageSourcePanel from "@/app/components/mailclient/message/MessageSourcePanel";
import MarkdownPanel from "@/app/components/mailclient/message/MarkdownPanel";
import MessageViewPane from "@/app/components/mailclient/message/MessageViewPane";
import ThreadView from "@/app/components/mailclient/message/ThreadView";
import styles from "./page.module.css";

type MessageTab = "html" | "text" | "markdown" | "source";
type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew";
type DeleteResponse = {
  action: "deleted" | "moved";
  trashFolderId?: string | null;
  messageId?: string;
  previousMessageId?: string;
};

function extractEmails(value?: string) {
  if (!value) return [];
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  return matches ? matches.map((entry) => entry.trim()) : [];
}

function getPrimaryEmail(value?: string) {
  return extractEmails(value)[0] ?? null;
}

export default function MessageWindowPage() {
  const searchParams = useSearchParams();
  const accountId = searchParams.get("accountId") ?? "";
  const messageId = searchParams.get("messageId") ?? "";
  const [message, setMessage] = useState<Message | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [dateFormat, setDateFormat] = useState<AccountDateFormat>("locale");
  const [actionError, setActionError] = useState("");
  const [copyStatus, setCopyStatus] = useState<Record<string, boolean>>({});
  const [pendingMessageActions, setPendingMessageActions] = useState<Set<string>>(new Set());
  const [messageTabs, setMessageTabs] = useState<Record<string, MessageTab>>({});
  const [collapsedMessages, setCollapsedMessages] = useState<Record<string, boolean>>({});
  const [messageFontScale, setMessageFontScale] = useState<Record<string, number>>({});
  const [messageZoom, setMessageZoom] = useState<Record<string, number>>({});
  const [darkMode] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("noctua:theme") === "dark"
  );
  const messageRefs = useRef<Map<string, HTMLElement>>(new Map());
  const sourceFetchRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const missingParams = !accountId || !messageId;

  useEffect(() => {
    let active = true;
    if (missingParams) return () => {
      active = false;
    };
    void (async () => {
      try {
        const [messageRes, foldersRes, accountsRes] = await Promise.all([
          fetch(
            `/api/message?accountId=${encodeURIComponent(accountId)}&messageId=${encodeURIComponent(messageId)}`,
            { credentials: "include" }
          ),
          fetch("/api/folders", { credentials: "include" }),
          fetch("/api/accounts", { credentials: "include" })
        ]);
        if (!active) return;
        if (!messageRes.ok) {
          const body = (await messageRes.json().catch(() => null)) as { message?: string } | null;
          setStatus("error");
          setError(body?.message || `Failed to load message (${messageRes.status}).`);
          return;
        }
        const messageData = (await messageRes.json()) as { message?: Message };
        const nextMessage = messageData?.message ?? null;
        if (!nextMessage) {
          setStatus("error");
          setError("Message not found.");
          return;
        }
        const foldersData = foldersRes.ok
          ? (((await foldersRes.json()) as Folder[]) ?? [])
          : [];
        const accountsData = accountsRes.ok
          ? (((await accountsRes.json()) as Account[]) ?? [])
          : [];
        setMessage(nextMessage);
        setFolders(foldersData.filter((folder) => folder.accountId === nextMessage.accountId));
        const currentAccount =
          accountsData.find((account) => account.id === nextMessage.accountId) ?? null;
        setDateFormat(normalizeAccountDateFormat(currentAccount?.settings?.appearance?.dateFormat));
        setCollapsedMessages({ [nextMessage.id]: false });
        setStatus("ready");
      } catch {
        if (!active) return;
        setStatus("error");
        setError("Failed to load message.");
      }
    })();
    return () => {
      active = false;
    };
  }, [accountId, messageId, missingParams]);

  const folderById = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder])),
    [folders]
  );
  const isTrashFolder = useCallback(
    (folderId?: string | null) =>
      ((folderId ? folderById.get(folderId) : null)?.specialUse ?? "").toLowerCase() ===
      "\\trash",
    [folderById]
  );

  const handleDownloadEml = useCallback(async (target: Message) => {
    try {
      const res = await fetch(
        `/api/source?accountId=${encodeURIComponent(target.accountId)}&messageId=${encodeURIComponent(
          target.id
        )}`,
        { credentials: "include" }
      );
      if (!res.ok) return;
      const data = (await res.json()) as { source?: string };
      if (!data?.source) return;
      const blob = new Blob([data.source], { type: "message/rfc822" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${target.subject || "message"}.eml`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }, []);

  const applyFlagsToMessage = useCallback((flags: string[]) => {
    setMessage((prev) => {
      if (!prev) return prev;
      const nextSeen = flags.some((flag) => flag.toLowerCase() === "\\seen");
      return {
        ...prev,
        flags,
        seen: nextSeen,
        answered: flags.some((flag) => flag.toLowerCase() === "\\answered"),
        flagged: flags.some((flag) => flag.toLowerCase() === "\\flagged"),
        deleted: flags.some((flag) => flag.toLowerCase() === "\\deleted"),
        draft: flags.some((flag) => flag.toLowerCase() === "\\draft"),
        recent: flags.some((flag) => flag.toLowerCase() === "\\recent"),
        unread: !nextSeen
      };
    });
  }, []);

  const runMessageFlagRequest = useCallback(
    async (target: Message, payload: Record<string, unknown>) => {
      setPendingMessageActions((prev) => new Set(prev).add(target.id));
      setActionError("");
      try {
        const res = await fetch("/api/message/flags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            accountId: target.accountId,
            messageId: target.id,
            ...payload
          })
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          setActionError(body?.message || `Failed to update message (${res.status}).`);
          return;
        }
        const data = (await res.json()) as { flags?: string[] };
        applyFlagsToMessage(data.flags ?? []);
      } catch {
        setActionError("Failed to update message.");
      } finally {
        setPendingMessageActions((prev) => {
          const next = new Set(prev);
          next.delete(target.id);
          return next;
        });
      }
    },
    [applyFlagsToMessage]
  );

  const updateFlagState = useCallback(
    async (
      target: Message,
      flag: "seen" | "answered" | "flagged" | "draft" | "deleted",
      value: boolean
    ) => {
      await runMessageFlagRequest(target, { flag, value });
    },
    [runMessageFlagRequest]
  );

  const handleDeleteMessage = useCallback(
    async (target: Message) => {
      setPendingMessageActions((prev) => new Set(prev).add(target.id));
      setActionError("");
      try {
        const res = await fetch("/api/message/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            accountId: target.accountId,
            messageId: target.id
          })
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          setActionError(body?.message || `Failed to delete message (${res.status}).`);
          return;
        }
        const data = (await res.json()) as DeleteResponse;
        notifyDetachedMessageDeleted({
          accountId: target.accountId,
          action: data.action,
          previousMessageId: data.previousMessageId ?? target.id,
          messageId: data.messageId ?? target.id,
          trashFolderId: data.trashFolderId ?? null
        });
        window.close();
      } catch {
        setActionError("Failed to delete message.");
      } finally {
        setPendingMessageActions((prev) => {
          const next = new Set(prev);
          next.delete(target.id);
          return next;
        });
      }
    },
    []
  );

  const handleOpenHtmlInNewWindow = useCallback((target: Message) => {
    const params = new URLSearchParams({
      accountId: target.accountId,
      messageId: target.id
    });
    openDetachedWindow(`/api/message/html?${params.toString()}`);
  }, []);

  const readErrorMessage = useCallback(async (res: Response) => {
    try {
      const data = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
      if (typeof data?.message === "string" && data.message.trim()) return data.message;
      if (typeof data?.error === "string" && data.error.trim()) return data.error;
    } catch {
      // ignore
    }
    return `Request failed (${res.status})`;
  }, []);

  const reportError = useCallback((message: string) => {
    setActionError(message);
  }, []);

  const fetchSource = useCallback(async (targetMessageId: string) => {
    const existing = sourceFetchRef.current.get(targetMessageId);
    if (existing) return existing;
    const promise = (async () => {
      try {
        const res = await fetch(
          `/api/source?accountId=${encodeURIComponent(accountId)}&messageId=${encodeURIComponent(targetMessageId)}`,
          { credentials: "include" }
        );
        if (!res.ok) return null;
        const data = (await res.json()) as { source?: string };
        return data.source ?? "";
      } catch {
        return null;
      } finally {
        sourceFetchRef.current.delete(targetMessageId);
      }
    })();
    sourceFetchRef.current.set(targetMessageId, promise);
    return promise;
  }, [accountId]);

  const scrubSource = (source?: string) =>
    (source ?? "").replace(/([A-Za-z0-9+/=]{200,})/g, "[base64 omitted]");

  const renderSourcePanel = (targetMessageId: string) => (
    <MessageSourcePanel
      messageId={targetMessageId}
      fetchSource={fetchSource}
      scrubSource={scrubSource}
    />
  );

  const renderMarkdownPanel = (body: string | undefined, targetMessageId: string) => (
    <MarkdownPanel body={body} fontScale={messageFontScale[targetMessageId] ?? 1} />
  );

  const adjustMessageZoom = (targetMessageId: string, delta: number) => {
    setMessageZoom((prev) => {
      const current = prev[targetMessageId] ?? 1;
      const next = Math.min(2.4, Math.max(0.5, Number((current + delta).toFixed(2))));
      return { ...prev, [targetMessageId]: next };
    });
  };

  const resetMessageZoom = (targetMessageId: string) => {
    setMessageZoom((prev) => {
      if (!(targetMessageId in prev)) return prev;
      const { [targetMessageId]: _omit, ...rest } = prev;
      return rest;
    });
  };

  const triggerCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus((prev) => ({ ...prev, [key]: true }));
      window.setTimeout(() => {
        setCopyStatus((prev) => ({ ...prev, [key]: false }));
      }, 1200);
    } catch {
      // ignore
    }
  };

  const safeMessage = message;
  const noop = () => {};
  const renderState = (message: string, color: "gray" | "red" = "gray") => (
    <div className={styles.state}>
      <Text size="2" color={color}>
        {message}
      </Text>
    </div>
  );

  return (
    <div className={styles.page}>
      {missingParams ? (
        renderState("Missing accountId or messageId.", "red")
      ) : status === "loading" ? (
        renderState("Loading message…")
      ) : status === "error" || !safeMessage ? (
        renderState(error || "Failed to load message.", "red")
      ) : (
        <>
          {actionError && (
            <Text size="2" color="red">{actionError}</Text>
          )}
          <MessageViewPane onShowJson={noop} onEvictThreadCache={noop} hideToolbar>
            <ThreadView
              showComposeInline={false}
              activeMessage={safeMessage}
              activeThread={[safeMessage]}
              supportsThreads={false}
              threadContentById={{}}
              threadContentLoading={null}
              threadContentErrorById={{}}
              composeReplyMessageId={null}
              renderComposeInlineCard={null}
              messageCardProps={{
                messageRefs,
                pendingMessageActions,
                ensureMessageContent: async () => null,
                messageContentLoading: {},
                includeThreadAcrossFolders: false,
                activeFolderId: safeMessage.folderId,
                threadPathById: (folderId: string) =>
                  folderId.replace(`${safeMessage.accountId}:`, ""),
                folderNameById: (folderId: string) => folderById.get(folderId)?.name ?? folderId,
                setSearchScope: noop as React.Dispatch<React.SetStateAction<"folder" | "all">>,
                setActiveFolderId: noop as React.Dispatch<React.SetStateAction<string>>,
                getImapFlagBadges,
                toggleFlaggedFlag: (target) => {
                  void updateFlagState(target, "flagged", !Boolean(target.flagged));
                },
                toggleTodoFlag: noop as (message: Message) => void,
                isDraftMessage: (target) => Boolean(target.draft),
                openCompose: noop as (mode: ComposeMode, message?: Message) => void,
                renderQuickActions: (target) => (
                  <MessageQuickActions
                    message={target}
                    iconSize={14}
                    origin="thread"
                    isDraft={Boolean(target.draft)}
                    actionVisibility={{
                      editDraft: false,
                      reply: false,
                      replyAll: false,
                      forward: false,
                      showRelated: false
                    }}
                    pendingMessageActions={pendingMessageActions}
                    openCompose={noop}
                    handleDeleteMessage={handleDeleteMessage}
                    onShowRelated={noop}
                    isTrashFolder={isTrashFolder}
                  />
                ),
                renderMessageMenu: (target, _view, onOpenChange) => (
                  <MessageMenu
                    message={target}
                    origin="thread"
                    isDraft={Boolean(target.draft)}
                    actionVisibility={{
                      editDraft: false,
                      reply: false,
                      replyAll: false,
                      forward: false,
                      editAsNew: false,
                      todo: false,
                      answered: false,
                      spam: false,
                      archive: false,
                      category: false,
                      showRelated: false,
                      showThread: false,
                      openWindow: false,
                      resync: false
                    }}
                    pendingMessageActions={pendingMessageActions}
                    openCompose={noop}
                    updateFlagState={updateFlagState}
                    toggleTodoFlag={noop}
                    clearTodoFlag={noop}
                    handleMarkSpam={noop}
                    handleMarkNotSpam={noop}
                    handleArchiveMessage={noop}
                    handleSetCategory={noop}
                    handleDeleteMessage={handleDeleteMessage}
                    handleUnsubscribe={noop}
                    handleDownloadEml={handleDownloadEml}
                    handleResyncMessage={noop}
                    handleOpenInNewWindow={noop}
                    handleOpenHtmlInNewWindow={handleOpenHtmlInNewWindow}
                    onShowRelated={noop}
                    onShowThread={noop}
                    allTopics={[]}
                    onFetchSuggestions={async () => []}
                    onAssignTopics={noop}
                    onToggleTopic={noop}
                    onGetRecentFolders={() => []}
                    onMoveToFolder={noop}
                    onMoveTo={noop}
                    isTrashFolder={isTrashFolder}
                    isSpamFolder={() => false}
                    onOpenChange={onOpenChange}
                  />
                ),
                handleUnsubscribe: noop,
                readErrorMessage,
                reportError,
                collapsedMessages,
                setCollapsedMessages,
                messageTabs,
                setMessageTabs,
                fetchSource,
                setMessageFontScale,
                messageFontScale,
                adjustMessageZoom,
                resetMessageZoom,
                messageZoom,
                darkMode,
                hasHtmlContent,
                renderMarkdownPanel,
                renderSourcePanel,
                handleSelectMessage: noop as (message: Message) => void,
                messageByMessageId: new Map(
                  safeMessage.messageId ? [[safeMessage.messageId, safeMessage]] : []
                ),
                getPrimaryEmail,
                extractEmails,
                dateFormat
              }}
            />
          </MessageViewPane>
        </>
      )}
    </div>
  );
}
