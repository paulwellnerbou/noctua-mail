import type React from "react";
import type { Message } from "@/lib/data";
import type { ComposePayload } from "./composeContentBuilder";
import type {
  ComposeReplyHeaders,
  ComposeSelectionState,
  ComposeTab,
  ComposeView,
  DraftSavePayload
} from "./composeTypes";

export type UseDraftManagerParams = {
  // Account context
  activeAccountId: string | null;

  // Compose content fields (for handleSaveDraft)
  composeOpen: boolean;
  composeTab: ComposeTab;
  composeTo: string;
  composeCc: string;
  composeBcc: string;
  composeSubject: string;
  composeQuotedHtmlEdited: boolean;
  composeReplyHeaders: ComposeReplyHeaders | null;
  composeDraftId: string | null;

  // Setters from useComposeState
  setComposeDraftId: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftSaving: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftSavedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setDraftSaveError: React.Dispatch<React.SetStateAction<string | null>>;
  setDiscardingDraft: React.Dispatch<React.SetStateAction<boolean>>;
  setComposeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setComposeView: React.Dispatch<React.SetStateAction<ComposeView>>;

  // Refs from useComposeState
  composeDraftIdRef: React.MutableRefObject<string | null>;
  lastDraftHashRef: React.MutableRefObject<string>;
  currentDraftHashRef: React.MutableRefObject<string>;
  composeBaselineHashRef: React.MutableRefObject<string | null>;
  composeDirtyRef: React.MutableRefObject<boolean>;
  composeLastEditedRef: React.MutableRefObject<ComposeTab>;
  composeTextRef: React.RefObject<HTMLTextAreaElement | null>;
  composeSelectionRef: React.MutableRefObject<ComposeSelectionState | null>;
  pendingDraftSaveRef: React.MutableRefObject<{ payload: DraftSavePayload; hash: string } | null>;
  draftSaveInFlightRef: React.MutableRefObject<boolean>;

  // Message state
  viewMessage: Message | null;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setViewMessage: React.Dispatch<React.SetStateAction<Message | null>>;
  setActiveMessageId: React.Dispatch<React.SetStateAction<string>>;

  // Routing state
  searchScope: string;
  activeFolderId: string | null;
  isDraftsFolder: (folderId?: string | null) => boolean;

  // MailClient-specific callbacks
  suppressDraftDeleteReconcile: (draftId: string | null) => void;
  removeDraftFromUi: (draftId: string | null) => void;
  refreshFolders: () => Promise<unknown>;
  refreshMailboxData: () => Promise<unknown>;

  // Utilities
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;
  reportError: (message: string) => void;
  readErrorMessage: (res: Response) => Promise<string>;

  // Content builder
  buildComposePayload: (options?: { preferText?: boolean }) => ComposePayload;
};

export function useDraftManager(params: UseDraftManagerParams) {
  const {
    activeAccountId,
    composeOpen,
    composeTab,
    composeTo,
    composeCc,
    composeBcc,
    composeSubject,
    composeQuotedHtmlEdited,
    composeReplyHeaders,
    composeDraftId,
    setComposeDraftId,
    setDraftSaving,
    setDraftSavedAt,
    setDraftSaveError,
    setDiscardingDraft,
    setComposeOpen,
    setComposeView,
    composeDraftIdRef,
    lastDraftHashRef,
    currentDraftHashRef,
    composeBaselineHashRef,
    composeDirtyRef,
    composeLastEditedRef,
    composeTextRef,
    composeSelectionRef,
    pendingDraftSaveRef,
    draftSaveInFlightRef,
    viewMessage,
    setMessages,
    setViewMessage,
    setActiveMessageId,
    searchScope,
    activeFolderId,
    isDraftsFolder,
    suppressDraftDeleteReconcile,
    removeDraftFromUi,
    refreshFolders,
    refreshMailboxData,
    apiFetch,
    reportError,
    readErrorMessage,
    buildComposePayload
  } = params;

  const saveDraftNow = async (payload: DraftSavePayload, hash: string) => {
    if (!activeAccountId) return;
    suppressDraftDeleteReconcile(composeDraftIdRef.current);
    if (composeTab === "text" && composeTextRef.current) {
      const element = composeTextRef.current;
      composeSelectionRef.current = {
        start: element.selectionStart ?? 0,
        end: element.selectionEnd ?? 0,
        value: element.value
      };
    }
    setDraftSaving(true);
    try {
      const res = await apiFetch("/api/drafts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: activeAccountId,
          draftId: composeDraftIdRef.current,
          ...payload
        })
      });
      if (!res.ok) {
        const message = await readErrorMessage(res);
        reportError(message);
        setDraftSaveError(message || "Draft save failed.");
        return;
      }
      const data = (await res.json()) as { draftId?: string | null };
      if (data?.draftId) {
        const previousDraftId = composeDraftIdRef.current;
        if (previousDraftId && previousDraftId !== data.draftId) {
          setMessages((prev) => prev.filter((msg) => msg.id !== previousDraftId));
          if (viewMessage?.id === previousDraftId) {
            setViewMessage({ ...viewMessage, id: data.draftId });
            setActiveMessageId(data.draftId);
          }
        }
        composeDraftIdRef.current = data.draftId;
        setComposeDraftId(data.draftId);
      }
      lastDraftHashRef.current = hash;
      const latestHash = currentDraftHashRef.current;
      if (!latestHash || latestHash === hash) {
        composeDirtyRef.current = false;
      }
      setDraftSavedAt(Date.now());
      setDraftSaveError(null);
      await refreshFolders();
      if (searchScope === "folder" && isDraftsFolder(activeFolderId)) {
        await refreshMailboxData();
      }
    } catch {
      reportError("Failed to save draft.");
      setDraftSaveError("Draft save failed.");
    } finally {
      setDraftSaving(false);
      if (composeTab === "text" && composeTextRef.current && composeSelectionRef.current) {
        const element = composeTextRef.current;
        const { start, end, value } = composeSelectionRef.current;
        composeSelectionRef.current = null;
        requestAnimationFrame(() => {
          if (document.activeElement !== element || element.value !== value) return;
          try {
            element.setSelectionRange(start, end);
          } catch {
            // ignore selection errors
          }
        });
      }
    }
  };

  const runQueuedDraftSaves = () => {
    if (draftSaveInFlightRef.current) return;
    draftSaveInFlightRef.current = true;
    void (async () => {
      try {
        while (pendingDraftSaveRef.current) {
          const next = pendingDraftSaveRef.current;
          pendingDraftSaveRef.current = null;
          await saveDraftNow(next.payload, next.hash);
        }
      } finally {
        draftSaveInFlightRef.current = false;
        if (pendingDraftSaveRef.current) {
          runQueuedDraftSaves();
        }
      }
    })();
  };

  const saveDraft = (payload: DraftSavePayload, hash: string) => {
    pendingDraftSaveRef.current = { payload, hash };
    runQueuedDraftSaves();
  };

  const handleDiscardDraft = async () => {
    if (composeDraftId && activeAccountId) {
      try {
        setDiscardingDraft(true);
        suppressDraftDeleteReconcile(composeDraftId);
        const res = await apiFetch("/api/drafts/discard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: activeAccountId,
            draftId: composeDraftId
          })
        });
        if (!res.ok) {
          reportError(await readErrorMessage(res));
        } else {
          removeDraftFromUi(composeDraftId);
          if (searchScope === "folder" && activeFolderId) {
            void refreshMailboxData();
          }
        }
        await refreshFolders();
      } catch {
        reportError("Failed to discard draft.");
      } finally {
        setDiscardingDraft(false);
      }
    }
    lastDraftHashRef.current = "";
    currentDraftHashRef.current = "";
    composeBaselineHashRef.current = null;
    setDraftSavedAt(null);
    setDraftSaveError(null);
    setComposeDraftId(null);
    setComposeOpen(false);
    setComposeView("inline");
  };

  const handleSaveDraft = () => {
    if (!composeOpen || !activeAccountId) return;
    const preferText = composeTab === "html" && composeLastEditedRef.current === "text";
    const { text, html, attachments, composeFormat } = buildComposePayload({ preferText });
    const normalizedHtml = html ?? "";
    const attachmentsHash = attachments
      .map((att) => `${att.filename}:${att.size}:${att.inline ? "1" : "0"}:${att.cid ?? ""}`)
      .join("|");
    const hash = JSON.stringify({
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
      subject: composeSubject,
      text,
      html: normalizedHtml,
      attachments: attachmentsHash
    });
    const payload: DraftSavePayload = {
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
      subject: composeSubject,
      text,
      html: normalizedHtml,
      composeFormat,
      quotedHtmlEdited: composeQuotedHtmlEdited,
      inReplyTo: composeReplyHeaders?.inReplyTo,
      references: composeReplyHeaders?.references,
      xForwardedMessageId: composeReplyHeaders?.xForwardedMessageId,
      attachments
    };
    saveDraft(payload, hash);
  };

  return { saveDraft, handleDiscardDraft, handleSaveDraft };
}
