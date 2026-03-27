import { useRef } from "react";
import type React from "react";
import type { ComposeInviteDraft } from "@/lib/composeInvite";
import {
  buildAccountDraftDiscardPath,
  buildAccountDraftSavePath
} from "@/lib/accountApiPaths";
import type { Message } from "@/lib/data";
import type { ComposePayload } from "./composeContentBuilder";
import { buildDraftSavePayload, computeDraftHash } from "./draftSaveUtils";
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
  composeInvite?: ComposeInviteDraft | null;
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
  reconcileSavedDraftInUi: (savedDraft: Message, previousDraftId: string | null) => void;
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
    composeInvite,
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
    reconcileSavedDraftInUi,
    refreshFolders,
    refreshMailboxData,
    apiFetch,
    reportError,
    readErrorMessage,
    buildComposePayload
  } = params;
  const activeAccountIdRef = useRef(activeAccountId);
  const accountScopeVersionRef = useRef(0);
  if (activeAccountIdRef.current !== activeAccountId) {
    activeAccountIdRef.current = activeAccountId;
    accountScopeVersionRef.current += 1;
  }

  const saveDraftNow = async (payload: DraftSavePayload, hash: string) => {
    if (!activeAccountId) return;
    const requestAccountId = activeAccountId;
    const requestScopeVersion = accountScopeVersionRef.current;
    const isCurrentRequest = () =>
      activeAccountIdRef.current === requestAccountId &&
      accountScopeVersionRef.current === requestScopeVersion;
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
      const res = await apiFetch(buildAccountDraftSavePath(activeAccountId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: composeDraftIdRef.current,
          ...payload
        })
      });
      if (!isCurrentRequest()) return;
      if (!res.ok) {
        const message = await readErrorMessage(res);
        if (!isCurrentRequest()) return;
        reportError(message);
        setDraftSaveError(message || "Draft save failed.");
        return;
      }
      const previousDraftId = composeDraftIdRef.current;
      const data = (await res.json()) as { draftId?: string | null; message?: Message | null };
      if (!isCurrentRequest()) return;
      const savedDraft = data?.message ? { ...data.message, draftInvite: payload.invite ?? null } : null;
      if (data?.draftId) {
        if (previousDraftId && previousDraftId !== data.draftId) {
          if (!savedDraft) {
            setMessages((prev) => prev.filter((msg) => msg.id !== previousDraftId));
            if (viewMessage?.id === previousDraftId) {
              setViewMessage({ ...viewMessage, id: data.draftId });
              setActiveMessageId(data.draftId);
            }
          }
        }
        composeDraftIdRef.current = data.draftId;
        setComposeDraftId(data.draftId);
      }
      if (savedDraft) {
        reconcileSavedDraftInUi(savedDraft, previousDraftId);
      }
      lastDraftHashRef.current = hash;
      const latestHash = currentDraftHashRef.current;
      if (!latestHash || latestHash === hash) {
        composeDirtyRef.current = false;
      }
      setDraftSavedAt(Date.now());
      setDraftSaveError(null);
      await refreshFolders();
      if (!savedDraft && searchScope === "folder" && isDraftsFolder(activeFolderId)) {
        await refreshMailboxData();
      }
    } catch {
      if (!isCurrentRequest()) return;
      reportError("Failed to save draft.");
      setDraftSaveError("Draft save failed.");
    } finally {
      if (!isCurrentRequest()) return;
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
        const res = await apiFetch(buildAccountDraftDiscardPath(activeAccountId, composeDraftId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
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
    const composePayload = buildComposePayload({ preferText });
    const hash = computeDraftHash({
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
      subject: composeSubject,
      text: composePayload.text,
      html: composePayload.html,
      attachments: composePayload.attachments,
      invite: composeInvite
    });
    const payload: DraftSavePayload = buildDraftSavePayload(
      {
        to: composeTo,
        cc: composeCc,
        bcc: composeBcc,
        subject: composeSubject,
        composeQuotedHtmlEdited,
        composeReplyHeaders,
        invite: composeInvite
      },
      composePayload
    );
    saveDraft(payload, hash);
  };

  return { saveDraft, handleDiscardDraft, handleSaveDraft };
}
