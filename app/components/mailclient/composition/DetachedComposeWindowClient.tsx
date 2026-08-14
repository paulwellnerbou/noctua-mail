"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text } from "@radix-ui/themes";
import { AccountDateFormatProvider } from "@/app/components/AccountDateFormatContext";
import InAppNoticeStack, { type InAppNotice } from "@/app/components/mailclient/InAppNoticeStack";
import {
  buildAccountApiPath,
  buildAccountComposeRecipientsPath,
  buildAccountFoldersPath,
  buildAccountMessageActionPath,
  buildAccountMessagePath
} from "@/lib/accountApiPaths";
import { normalizeAccountDateFormat } from "@/lib/dateFormatting";
import type { Account, Folder, Message, RecipientSuggestion } from "@/lib/data";
import { stripHtmlToText } from "@/lib/html";
import { getRecipientInputToken, replaceLastRecipientToken } from "@/lib/recipientLists";
import { findSentFolder as findSentFolderFromFolders } from "@/lib/specialFolders";
import type { SyncMode } from "@/lib/syncPolicy";
import {
  notifyDetachedComposeOutcome,
  notifyDetachedComposeUpdated,
  shouldProtectDetachedComposeWindow,
  touchDetachedComposeHandoff,
  updateDetachedComposeDraftId,
  type DetachedComposeHandoff,
  type DetachedComposeOutcome
} from "@/lib/ui/detachedComposeHandoff";
import ComposeOrchestrator, {
  type ComposeMirror,
  type ComposeOrchestratorHandle
} from "./ComposeOrchestrator";

type ReadyHandoff = Extract<DetachedComposeHandoff, { status: "ready" }>;

type DetachedComposeWindowClientProps = {
  handoffId: string;
  handoff: ReadyHandoff;
};

function getAccountFromValue(account: Account) {
  const name = account.name.trim();
  return name ? `${name} <${account.email}>` : account.email;
}

function formatRelativeTime(timestamp: number | null) {
  if (!timestamp) return "";
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function makeNoticeId() {
  return window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export default function DetachedComposeWindowClient({
  handoffId,
  handoff
}: DetachedComposeWindowClientProps) {
  const composeHandleRef = useRef<ComposeOrchestratorHandle | null>(null);
  const openedRef = useRef(false);
  const completedRef = useRef(false);
  const recipientCacheRef = useRef<RecipientSuggestion[] | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [draft, setDraft] = useState<Message | null>(null);
  const [sourceMessage, setSourceMessage] = useState<Message | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [viewMessage, setViewMessage] = useState<Message | null>(null);
  const [, setActiveMessageId] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [notices, setNotices] = useState<InAppNotice[]>([]);
  const [composeMirror, setComposeMirror] = useState<ComposeMirror>({
    composeOpen: false,
    composeView: "modal",
    composeMode: handoff.mode,
    composeDraftId: handoff.draftId,
    composeReplyMessage: null,
    hasUnsavedChanges: false,
    draftSaving: false,
    sendingMail: false,
    discardingDraft: false
  });
  const composeMirrorRef = useRef(composeMirror);
  const [darkMode] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("noctua:theme") === "dark"
  );
  const clientId = useMemo(() => {
    if (typeof window === "undefined") return "";
    const key = "noctuaClientId";
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const next = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    window.localStorage.setItem(key, next);
    return next;
  }, []);

  const apiFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (clientId) headers.set("X-Noctua-Client", clientId);
    return fetch(input, { ...init, headers, credentials: "include" });
  }, [clientId]);

  const readErrorMessage = useCallback(async (response: Response) => {
    const body = (await response.clone().json().catch(() => null)) as
      | { message?: string; error?: string; details?: string }
      | null;
    const message = body?.message || body?.error || body?.details;
    if (message?.trim()) return message;
    const text = await response.text().catch(() => "");
    return text.trim() || `Request failed (${response.status}).`;
  }, []);

  const pushNotice = useCallback((input: {
    type: "info" | "success" | "warning" | "error";
    icon?: "mail";
    title: string;
    description?: string;
    messageId?: string;
    ids?: string[];
    durationMs?: number;
  }) => {
    const now = Date.now();
    const notice: InAppNotice = {
      ...input,
      id: makeNoticeId(),
      expiresAt: input.durationMs ? now + input.durationMs : null
    };
    setNotices((current) => [...current, notice].slice(-5));
  }, []);

  const reportError = useCallback((message: string) => {
    pushNotice({
      type: "error",
      title: "Composer error",
      description: message || "The operation failed."
    });
  }, [pushNotice]);

  const refreshFolders = useCallback(async () => {
    try {
      const response = await apiFetch(buildAccountFoldersPath(handoff.accountId), {
        cache: "no-store"
      });
      if (!response.ok) {
        reportError(await readErrorMessage(response));
        return [];
      }
      const nextFolders = (await response.json()) as Folder[];
      setFolders(nextFolders.filter((folder) => folder.accountId === handoff.accountId));
      return nextFolders;
    } catch {
      reportError("Failed to refresh folders.");
      return [];
    }
  }, [apiFetch, handoff.accountId, readErrorMessage, reportError]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [accountsResponse, foldersResponse, draftResponse, sourceResponse] = await Promise.all([
          apiFetch("/api/accounts", { cache: "no-store" }),
          apiFetch(buildAccountFoldersPath(handoff.accountId), { cache: "no-store" }),
          handoff.draftId
            ? apiFetch(buildAccountMessagePath(handoff.accountId, handoff.draftId), {
                cache: "no-store"
              })
            : Promise.resolve(null),
          handoff.sourceMessageId && handoff.sourceMessageId !== handoff.draftId
            ? apiFetch(
                buildAccountMessagePath(handoff.accountId, handoff.sourceMessageId),
                { cache: "no-store" }
              ).catch(() => null)
            : Promise.resolve(null)
        ]);
        if (cancelled) return;
        if (!accountsResponse.ok) throw new Error(await readErrorMessage(accountsResponse));
        if (!foldersResponse.ok) throw new Error(await readErrorMessage(foldersResponse));
        if (draftResponse && !draftResponse.ok) throw new Error(await readErrorMessage(draftResponse));

        const accounts = (await accountsResponse.json()) as Account[];
        const nextAccount = accounts.find((candidate) => candidate.id === handoff.accountId) ?? null;
        if (!nextAccount) throw new Error("The account for this composer is no longer available.");
        const nextFolders = (await foldersResponse.json()) as Folder[];
        const draftData = draftResponse
          ? ((await draftResponse.json()) as { message?: Message | null })
          : null;
        const nextDraft = draftData?.message ?? null;
        if (handoff.draftId && !nextDraft) throw new Error("Draft not found.");
        const sourceData = sourceResponse?.ok
          ? ((await sourceResponse.json()) as { message?: Message | null })
          : null;
        const nextSource = handoff.sourceMessageId === handoff.draftId
          ? nextDraft
          : (sourceData?.message ?? null);
        setAccount(nextAccount);
        setFolders(nextFolders.filter((folder) => folder.accountId === handoff.accountId));
        setDraft(nextDraft);
        setSourceMessage(nextSource);
        const loadedMessages = [nextDraft, nextSource].filter(
          (message): message is Message => Boolean(message)
        );
        setMessages(Array.from(
          new Map(loadedMessages.map((message) => [message.id, message])).values()
        ));
        setViewMessage(nextDraft);
        setActiveMessageId(nextDraft?.id ?? "");
        setStatus("ready");
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to open composer.");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiFetch, handoff, readErrorMessage]);

  useEffect(() => {
    if (status !== "ready" || !account || openedRef.current || !composeHandleRef.current) return;
    openedRef.current = true;
    void composeHandleRef.current
      .openDetachedCompose(draft, { mode: handoff.mode, sourceMessage })
      .catch((openError) => {
        setError(openError instanceof Error ? openError.message : "Failed to initialize composer.");
        setStatus("error");
      });
  }, [account, draft, handoff.mode, sourceMessage, status]);

  const handleComposeMirrorChange = useCallback((mirror: ComposeMirror) => {
    composeMirrorRef.current = mirror;
    setComposeMirror(mirror);
    updateDetachedComposeDraftId(handoffId, mirror.composeDraftId);
  }, [handoffId]);

  const handleDraftSavedAtChange = useCallback((timestamp: number | null) => {
    if (!timestamp) return;
    notifyDetachedComposeUpdated(
      handoffId,
      handoff,
      composeMirrorRef.current.composeDraftId
    );
  }, [handoff, handoffId]);

  useEffect(() => {
    const shouldProtect = shouldProtectDetachedComposeWindow({
      completed: completedRef.current,
      hasUnsavedChanges: composeMirror.hasUnsavedChanges,
      draftSaving: composeMirror.draftSaving,
      sendingMail: composeMirror.sendingMail,
      discardingDraft: composeMirror.discardingDraft
    });
    if (!shouldProtect) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (completedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [composeMirror]);

  useEffect(() => {
    touchDetachedComposeHandoff(handoffId);
    const heartbeat = window.setInterval(
      () => touchDetachedComposeHandoff(handoffId),
      60_000
    );
    return () => window.clearInterval(heartbeat);
  }, [handoffId]);

  const finishDetachedCompose = useCallback((
    outcome: DetachedComposeOutcome,
    draftId: string | null
  ) => {
    completedRef.current = true;
    notifyDetachedComposeOutcome(handoffId, handoff, outcome, draftId);
  }, [handoff, handoffId]);

  const loadRecipientOptions = useCallback(async (query: string, signal: AbortSignal) => {
    const trimmed = query.trim();
    if (!trimmed && recipientCacheRef.current) return recipientCacheRef.current;
    const params = new URLSearchParams({ limit: "20" });
    if (trimmed) params.set("q", trimmed);
    const response = await apiFetch(
      buildAccountComposeRecipientsPath(handoff.accountId, params),
      { signal }
    );
    if (!response.ok) return [];
    const data = (await response.json()) as { recipients?: RecipientSuggestion[] };
    const recipients = data.recipients ?? [];
    if (!trimmed) recipientCacheRef.current = recipients;
    return recipients;
  }, [apiFetch, handoff.accountId]);

  const updateMessageFlag = useCallback(async (
    message: Message,
    payload: { flag?: "seen" | "answered" | "flagged" | "draft" | "deleted"; keyword?: string; value: boolean }
  ) => {
    try {
      const response = await apiFetch(
        buildAccountMessageActionPath(handoff.accountId, message.id, "flags"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );
      if (!response.ok) reportError(await readErrorMessage(response));
    } catch {
      reportError("The message was sent, but its reply or forward flag could not be updated.");
    }
  }, [apiFetch, handoff.accountId, readErrorMessage, reportError]);

  const syncFolderWithBackgroundRef = useRef(async (
    folderId: string,
    _allowRefresh?: boolean,
    mode?: SyncMode,
    options?: { backfillUids?: number[] }
  ) => {
    try {
      const startResponse = await apiFetch(buildAccountApiPath(handoff.accountId, "/sync"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folderId,
          mode,
          fullSync: mode === "full",
          backfillUids: options?.backfillUids
        })
      });
      if (!startResponse.ok) return;
      const startData = (await startResponse.json().catch(() => null)) as
        | { jobId?: string }
        | null;
      const jobId = startData?.jobId?.trim();
      if (!jobId) return;
      const startedAt = Date.now();
      while (Date.now() - startedAt < 60_000) {
        const statusResponse = await apiFetch(
          buildAccountApiPath(
            handoff.accountId,
            `/sync/status?jobId=${encodeURIComponent(jobId)}`
          ),
          { cache: "no-store" }
        );
        if (!statusResponse.ok) return;
        const statusData = (await statusResponse.json().catch(() => null)) as
          | { job?: { status?: "queued" | "running" | "done" | "failed" } }
          | null;
        if (statusData?.job?.status === "done" || statusData?.job?.status === "failed") return;
        await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
      }
    } catch {
      // Sending already succeeded; the main window also refreshes after the
      // completion event, so a failed best-effort Sent sync is non-fatal.
    }
  });

  const messageById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages]
  );
  const isDraftsFolder = useCallback((folderId?: string | null) => {
    const folder = folders.find((candidate) => candidate.id === folderId);
    return Boolean(
      folder &&
      (folder.specialUse?.toLowerCase() === "\\drafts" ||
        folder.name.toLowerCase().includes("draft"))
    );
  }, [folders]);

  if (status === "error") {
    return <DetachedComposeState color="red">{error || "Failed to open composer."}</DetachedComposeState>;
  }
  if (status === "loading" || !account) {
    return <DetachedComposeState color="gray">Opening composer…</DetachedComposeState>;
  }

  return (
    <AccountDateFormatProvider
      value={normalizeAccountDateFormat(account.settings?.appearance?.dateFormat)}
    >
      <div className="detached-compose-shell">
        <InAppNoticeStack
          style={{ zIndex: 100 }}
          state={{ inAppNotices: notices }}
          actions={{
            onOpenNotice: () => {},
            onDismissNotice: (noticeId) => {
              setNotices((current) => current.filter((notice) => notice.id !== noticeId));
            }
          }}
        />
        <ComposeOrchestrator
          ref={composeHandleRef}
          activeAccountId={handoff.accountId}
          currentAccount={account}
          accountDateFormat={normalizeAccountDateFormat(account.settings?.appearance?.dateFormat)}
          defaultSignatureId={account.settings?.defaultSignatureId ?? ""}
          accountSignatures={account.settings?.signatures ?? []}
          darkMode={darkMode}
          activeThread={sourceMessage ? [sourceMessage] : []}
          messageById={messageById}
          viewMessage={viewMessage}
          searchScope="folder"
          activeFolderId={draft?.folderId ?? null}
          isDraftsFolder={isDraftsFolder}
          setMessages={setMessages}
          setViewMessage={setViewMessage}
          setActiveMessageId={setActiveMessageId}
          suppressDraftDeleteReconcile={() => {}}
          removeDraftFromUi={(draftId) => {
            if (!draftId) return;
            setMessages((current) => current.filter((message) => message.id !== draftId));
          }}
          reconcileSavedDraftInUi={(savedDraft, previousDraftId) => {
            setMessages((current) => [
              ...current.filter((message) => message.id !== previousDraftId && message.id !== savedDraft.id),
              savedDraft
            ]);
            setViewMessage(savedDraft);
          }}
          refreshFolders={refreshFolders}
          refreshMailboxData={async () => {}}
          pushNotice={pushNotice}
          evictThreadCache={() => {}}
          updateFlagState={(message, flag, value) => updateMessageFlag(message, { flag, value })}
          updateKeywordFlag={(message, keyword, value) => updateMessageFlag(message, { keyword, value })}
          accountFolders={folders}
          findSentFolder={() => findSentFolderFromFolders(folders, handoff.accountId)}
          syncFolderWithBackgroundRef={syncFolderWithBackgroundRef}
          getPreferredComposeTab={() => undefined}
          isDraftMessage={(message) => isDraftsFolder(message.folderId) || Boolean(message.draft)}
          ensureMessageContent={async (message) => {
            const response = await apiFetch(
              buildAccountMessagePath(handoff.accountId, message.id),
              { cache: "no-store" }
            );
            if (!response.ok) throw new Error(await readErrorMessage(response));
            const data = (await response.json()) as { message?: Message | null };
            return data.message ?? message;
          }}
          applyRecipientSelection={(current, selection, setter) => {
            const next = replaceLastRecipientToken(current, selection.insertValue);
            setter(next);
            return next;
          }}
          loadRecipientOptions={loadRecipientOptions}
          clearRecipientSuggestionCache={() => {
            recipientCacheRef.current = null;
          }}
          getComposeToken={getRecipientInputToken}
          formatRelativeTime={formatRelativeTime}
          fromValue={getAccountFromValue(account)}
          apiFetch={apiFetch}
          reportError={reportError}
          readErrorMessage={readErrorMessage}
          stripHtml={stripHtmlToText}
          showComposeInline={
            composeMirror.composeOpen && composeMirror.composeView === "inline"
          }
          showComposeModal={
            composeMirror.composeOpen && composeMirror.composeView === "modal"
          }
          showComposeMinimized={false}
          detachedWindow
          onDraftSavedAtChange={handleDraftSavedAtChange}
          onComposeMirrorChange={handleComposeMirrorChange}
          onDetachedComposeOutcome={finishDetachedCompose}
        />
        {composeMirror.composeOpen && composeMirror.composeView === "inline"
          ? composeHandleRef.current?.renderInlineCard("detached-compose-card-slot")
          : null}
      </div>
    </AccountDateFormatProvider>
  );
}

function DetachedComposeState({
  color,
  children
}: {
  color: "gray" | "red";
  children: React.ReactNode;
}) {
  return (
    <div className="detached-compose-state">
      <Text size="2" color={color}>{children}</Text>
    </div>
  );
}
