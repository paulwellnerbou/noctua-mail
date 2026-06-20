import { useRef } from "react";
import type React from "react";
import type { ComposeInviteDraft } from "@/lib/composeInvite";
import {
  buildAccountDraftDiscardPath,
  buildAccountDraftSavePath
} from "@/lib/accountApiPaths";
import type { Message } from "@/lib/data";
import type { ComposePayload } from "./composeContentBuilder";
import { registerRecentLocalDraftSave } from "../recentLocalDraftSaves";
import { buildDraftSavePayload, getDraftChangeState } from "./draftSaveUtils";
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
  composeSessionVersionRef: React.MutableRefObject<number>;

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
    composeSessionVersionRef,
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
  const draftSaveLoopPromiseRef = useRef<Promise<void> | null>(null);
  if (activeAccountIdRef.current !== activeAccountId) {
    activeAccountIdRef.current = activeAccountId;
    accountScopeVersionRef.current += 1;
  }

  const saveDraftNow = async (payload: DraftSavePayload, hash: string) => {
    if (!activeAccountId) return;
    const requestAccountId = activeAccountId;
    const requestScopeVersion = accountScopeVersionRef.current;
    const requestComposeSessionVersion = composeSessionVersionRef.current;
    const isCurrentRequest = () =>
      activeAccountIdRef.current === requestAccountId &&
      accountScopeVersionRef.current === requestScopeVersion &&
      composeSessionVersionRef.current === requestComposeSessionVersion;
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
        registerRecentLocalDraftSave({
          accountId: requestAccountId,
          folderId: savedDraft.folderId,
          messageId: savedDraft.messageId ?? null,
          uid: savedDraft.imapUid ?? null
        });
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
    draftSaveLoopPromiseRef.current = (async () => {
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
        } else {
          draftSaveLoopPromiseRef.current = null;
        }
      }
    })();
  };

  // Await any in-flight or queued draft save until the save queue is fully
  // idle. Send/discard call this before acting on `composeDraftId`: a
  // debounced auto-save may still be APPENDing the draft to IMAP, and acting
  // before it settles leaves an orphan draft on the server that nothing
  // deletes (the discard would run against a stale or not-yet-known draft id).
  const flushPendingDraftSaves = async () => {
    while (draftSaveLoopPromiseRef.current) {
      await draftSaveLoopPromiseRef.current;
    }
  };

  const saveDraft = (payload: DraftSavePayload, hash: string) => {
    pendingDraftSaveRef.current = { payload, hash };
    runQueuedDraftSaves();
  };

  const handleDiscardDraft = async () => {
    // Let any in-flight or queued auto-save settle before discarding, mirroring
    // the send path. Otherwise a debounced save whose IMAP APPEND is still
    // running would orphan a draft the discard never sees (its id isn't known
    // yet). After flushing, read the id from the ref — the `composeDraftId`
    // state captured in this closure can be stale for a save that just
    // completed. Then bump the session version (and drop any queued save) so a
    // save kicked off by a stray debounce timer after this point abandons its
    // result instead of reconciling the just-discarded draft back into the list.
    await flushPendingDraftSaves();
    pendingDraftSaveRef.current = null;
    composeSessionVersionRef.current += 1;
    const draftId = composeDraftIdRef.current;
    if (draftId && activeAccountId) {
      try {
        setDiscardingDraft(true);
        suppressDraftDeleteReconcile(draftId);
        const res = await apiFetch(buildAccountDraftDiscardPath(activeAccountId, draftId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        if (!res.ok) {
          reportError(await readErrorMessage(res));
        } else {
          removeDraftFromUi(draftId);
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
    composeDraftIdRef.current = null;
    setComposeDraftId(null);
    setComposeOpen(false);
    setComposeView("inline");
  };

  const handleSaveDraft = () => {
    if (!composeOpen || !activeAccountId) return;
    const preferText = composeTab === "html" && composeLastEditedRef.current === "text";
    const composePayload = buildComposePayload({ preferText });
    const { hash, canManualSave } = getDraftChangeState({
      draftId: composeDraftIdRef.current,
      lastSavedHash: lastDraftHashRef.current,
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
      subject: composeSubject,
      text: composePayload.text,
      html: composePayload.html,
      attachments: composePayload.attachments,
      invite: composeInvite
    });
    if (!canManualSave) return;
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

  return { saveDraft, handleDiscardDraft, handleSaveDraft, flushPendingDraftSaves };
}
