"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import type React from "react";
import type { Account, AccountDateFormat, Attachment, Folder, Message, RecipientSuggestion } from "@/lib/data";
import {
  buildComposeInvitePayload,
  normalizeComposeInviteDraft,
  createDefaultComposeInviteDraft,
  type ComposeInviteDraft
} from "@/lib/composeInvite";
import { extractComposeInviteDraftFromSource } from "@/lib/composeInviteMetadata";
import {
  buildAccountDraftDiscardPath,
  buildAccountMessageSourcePath,
  buildAccountSmtpSendPath
} from "@/lib/accountApiPaths";
import { hasHtmlContent } from "@/lib/ui/messageView";
import {
  removeDetachedComposeHandoff,
  pruneExpiredDetachedComposeHandoffs,
  writeDetachedComposeHandoff,
  type DetachedComposeOutcome
} from "@/lib/ui/detachedComposeHandoff";
import { openDetachedWindowConfirmed } from "@/lib/ui/openDetachedWindow";
import { decidePostSendSentSync, type SyncMode } from "@/lib/syncPolicy";
import { logSyncPolicyCall } from "@/lib/syncPolicyLogging";
import { buildSendPayload } from "./buildSendPayload";
import ComposeInlineCard from "./ComposeInlineCard";
import ComposeMessageField from "./ComposeMessageField";
import ComposeMinimized from "./ComposeMinimized";
import ComposeModal from "./ComposeModal";
import { ComposeContextProvider, type ComposeContextValue } from "./ComposeContext";
import { getDraftChangeState } from "./draftSaveUtils";
import { normalizeHtmlDerivedText } from "./composeTextNormalization";
import { resetComposeSession } from "./resetComposeSession";
import { useComposeController } from "./useComposeController";
import { useComposeDraftAutoSave } from "./useComposeDraftAutoSave";
import {
  pruneUnreferencedInlineAttachments,
  useComposeHandlers
} from "./useComposeHandlers";
import { useComposeState } from "./useComposeState";
import { useComposeTranslation } from "./useComposeTranslation";
import { useComposeViewEffects } from "./useComposeViewEffects";
import { useDraftManager } from "./useDraftManager";
import type { ComposeMode } from "./composeTypes";

type Signature = {
  id: string;
  name: string;
  body: string;
};

type SyncFolderWithBackground = (
  folderId: string,
  allowRefresh?: boolean,
  mode?: SyncMode,
  options?: {
    backfillUids?: number[];
    fullSyncReason?: string;
    triggerId?: string;
    [key: string]: unknown;
  }
) => Promise<unknown> | unknown;

type PushNoticeInput = {
  type: "info" | "success" | "warning" | "error";
  icon?: "mail";
  title: string;
  description?: string;
  messageId?: string;
  ids?: string[];
  durationMs?: number;
};

export type ComposeOpenPrefill = {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  body?: string;
  // Note: `mailto:` URLs may carry `in-reply-to`/`references` headers, but they
  // are intentionally NOT plumbed here. buildSendPayload only emits those
  // headers when shouldThreadComposeForMode(mode) is true (reply/forward/edit),
  // and the mailto entry point uses mode "new". Adding the fields would set
  // composeReplyHeaders state but they'd silently drop on send — worse than not
  // claiming the feature. Plumb through a "newReply" mode if we ever need it.
};

export type ComposeOrchestratorHandle = {
  /**
   * Render the inline compose card. Returned from the handle so MailClient can
   * place it both at the top of the thread and inline beneath a reply target
   * via ThreadView's render-prop.
   */
  renderInlineCard: (wrapperClassName?: string) => React.ReactNode;
  /** Reset all compose state — used when the active account changes. */
  resetSession: () => void;
  /**
   * Open the compose surface. Hydrates attachments for edit/forward modes and
   * picks the preferred tab from the per-message tab state before handing off
   * to the underlying controller. When `prefill` is provided (only honored for
   * mode === "new" without a source message), the fields are applied after the
   * controller initializes blank state — used by the `mailto:` entry point.
   */
  openCompose: (
    mode: ComposeMode,
    message?: Message,
    asNew?: boolean,
    prefill?: ComposeOpenPrefill
  ) => Promise<void>;
  /** Restore a saved handoff while retaining reply/forward send semantics. */
  openDetachedCompose: (
    draft: Message | null,
    context: { mode: ComposeMode; sourceMessage: Message | null }
  ) => Promise<void>;
  /** Imperative setter used by MailClient's list selection auto-minimize. */
  setComposeView: React.Dispatch<React.SetStateAction<"inline" | "modal" | "minimized">>;
};

export type ComposeOrchestratorProps = {
  // Account context
  activeAccountId: string;
  currentAccount: Account | null;
  accountDateFormat: AccountDateFormat;
  defaultSignatureId: string;
  accountSignatures: Signature[];
  darkMode: boolean;

  // External data
  activeThread: Message[];
  messageById: Map<string, Message>;
  viewMessage: Message | null;
  searchScope: string;
  activeFolderId: string | null;
  isDraftsFolder: (folderId?: string | null) => boolean;

  // Callbacks / state setters from outside
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setViewMessage: React.Dispatch<React.SetStateAction<Message | null>>;
  setActiveMessageId: React.Dispatch<React.SetStateAction<string>>;
  suppressDraftDeleteReconcile: (draftId: string | null) => void;
  removeDraftFromUi: (draftId: string | null) => void;
  reconcileSavedDraftInUi: (savedDraft: Message, previousDraftId: string | null) => void;
  refreshFolders: () => Promise<unknown>;
  refreshMailboxData: () => Promise<unknown>;

  // Send-path collaborators
  pushNotice: (input: PushNoticeInput) => void;
  evictThreadCache: (threadId: string) => void;
  updateFlagState: (
    message: Message,
    flag: "seen" | "answered" | "flagged" | "draft" | "deleted",
    value: boolean
  ) => Promise<unknown> | unknown;
  updateKeywordFlag: (message: Message, keyword: string, value: boolean) => Promise<unknown> | unknown;
  accountFolders: Folder[];
  findSentFolder: () => Folder | null;
  syncFolderWithBackgroundRef: React.RefObject<SyncFolderWithBackground>;

  // openCompose wrapper collaborators
  //
  // Returns the editor-eligible body panel the user has selected for
  // `messageId` in the message-view pane ("html" / "text" / "markdown"),
  // or undefined if no selection has been made or the selection is
  // "source" (which has no compose-editor analogue). Used so the
  // compose surface matches the rendering the user was just looking
  // at. The underlying map lives in `MessageViewOrchestrator`.
  getPreferredComposeTab: (messageId: string) => "html" | "text" | "markdown" | undefined;
  isDraftMessage: (message: Message) => boolean;
  ensureMessageContent: (
    message: Message,
    options?: { manual?: boolean }
  ) => Promise<Message | null | undefined>;

  // Recipient / formatting helpers
  applyRecipientSelection: (
    current: string,
    selection: RecipientSuggestion,
    setter: React.Dispatch<React.SetStateAction<string>>,
    focusAfter?: "to" | "cc" | "bcc" | null
  ) => string;
  loadRecipientOptions: (query: string, signal: AbortSignal) => Promise<RecipientSuggestion[]>;
  clearRecipientSuggestionCache: (accountId: string) => void;
  getComposeToken: (value: string) => string;
  formatRelativeTime: (timestamp: number | null) => string;
  fromValue: string;

  // Utilities
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  reportError: (message: string) => void;
  readErrorMessage: (res: Response) => Promise<string>;
  stripHtml: (value: string) => string;

  // Visibility flags (derived in MailClient so they can drive layout)
  showComposeInline: boolean;
  showComposeModal: boolean;
  showComposeMinimized: boolean;

  /**
   * Fires whenever `draftSavedAt` changes so MailClient can drive its
   * second-by-second relative-time refresh. MailClient renders the
   * "saved N seconds ago" indicator and needs to re-render on every
   * tick while a saved draft exists.
   */
  onDraftSavedAtChange?: (timestamp: number | null) => void;

  /**
   * Fires whenever the compose state values that MailClient consumes
   * reactively change (thread focus, active message suppression, inline
   * compose placement, thread auto-collapse on compose focus). MailClient
   * mirrors these in its own `useState` so that existing memos and effects
   * keep their dependency semantics.
   */
  onComposeMirrorChange?: (mirror: ComposeMirror) => void;

  /** Run the compose session inside its own browser/native window. */
  detachedWindow?: boolean;

  /** Called synchronously before a detached window closes successfully. */
  onDetachedComposeOutcome?: (
    outcome: DetachedComposeOutcome,
    draftId: string | null
  ) => void;
};

/**
 * The subset of compose state that MailClient needs to react to for layout
 * and selection-related effects. Emitted via `onComposeMirrorChange`.
 */
export type ComposeMirror = {
  composeOpen: boolean;
  composeView: "inline" | "modal" | "minimized";
  composeMode: ComposeMode;
  composeDraftId: string | null;
  composeReplyMessage: Message | null;
  hasUnsavedChanges: boolean;
  draftSaving: boolean;
  sendingMail: boolean;
  discardingDraft: boolean;
};

function ComposeOrchestratorImpl(
  {
    activeAccountId,
    currentAccount,
    accountDateFormat,
    defaultSignatureId,
    accountSignatures,
    darkMode,
    activeThread,
    messageById,
    viewMessage,
    searchScope,
    activeFolderId,
    isDraftsFolder,
    setMessages,
    setViewMessage,
    setActiveMessageId,
    suppressDraftDeleteReconcile,
    removeDraftFromUi,
    reconcileSavedDraftInUi,
    refreshFolders,
    refreshMailboxData,
    pushNotice,
    evictThreadCache,
    updateFlagState,
    updateKeywordFlag,
    accountFolders,
    findSentFolder,
    syncFolderWithBackgroundRef,
    getPreferredComposeTab,
    isDraftMessage,
    ensureMessageContent,
    applyRecipientSelection,
    loadRecipientOptions,
    clearRecipientSuggestionCache,
    getComposeToken,
    formatRelativeTime,
    fromValue,
    apiFetch,
    reportError,
    readErrorMessage,
    stripHtml,
    showComposeInline,
    showComposeModal,
    showComposeMinimized,
    onDraftSavedAtChange,
    onComposeMirrorChange,
    detachedWindow = false,
    onDetachedComposeOutcome
  }: ComposeOrchestratorProps,
  ref: React.ForwardedRef<ComposeOrchestratorHandle>
) {
  const compose = useComposeState();
  const [detachingCompose, setDetachingCompose] = useState(false);
  const detachingComposeRef = useRef(false);
  const closingDetachedComposeRef = useRef(false);
  const discardingDraftRequestRef = useRef(false);
  const {
    composeOpen,
    setComposeOpen,
    composeView,
    setComposeView,
    composeDraftId,
    setComposeDraftId,
    composeMode,
    composeTo,
    setComposeTo,
    composeCc,
    setComposeCc,
    composeBcc,
    setComposeBcc,
    composeSubject,
    setComposeSubject,
    composeBody,
    setComposeBody,
    composeBodyDebounceRef,
    composeBodyLastUpdateRef,
    composeIncludeInvite,
    setComposeIncludeInvite,
    composeInviteLocation,
    setComposeInviteLocation,
    composeInviteStart,
    setComposeInviteStart,
    composeInviteEnd,
    setComposeInviteEnd,
    composeInviteAllDay,
    setComposeInviteAllDay,
    composeInviteRecurrenceRule,
    setComposeInviteRecurrenceRule,
    composeHtml,
    setComposeHtml,
    composeHtmlText,
    setComposeHtmlText,
    composeMarkdown,
    composeMarkdownRef,
    setComposeMarkdown,
    composeOpenedAt,
    composeSignatureId,
    setComposeSignatureId,
    signatureMenuOpen,
    setSignatureMenuOpen,
    composeReplyMessage,
    composeTab,
    setComposeTab,
    composeShowBcc,
    setComposeShowBcc,
    composeStripImages,
    setComposeStripImages,
    composeIncludeOriginal,
    setComposeIncludeOriginal,
    composeQuoteHtml,
    setComposeQuoteHtml,
    composeQuotedHtml,
    setComposeQuotedHtml,
    composeQuotedText,
    setComposeQuotedText,
    composeReplyHeaders,
    composeAttachments,
    setComposeAttachments,
    composeDragActive,
    setComposeDragActive,
    pendingImageDrop,
    setPendingImageDrop,
    composeEditorReset,
    setComposeEditorReset,
    composeQuotedParts,
    setComposeQuotedParts,
    composeQuotedHtmlEdited,
    composeSize,
    setComposeSize,
    composeResizing,
    setComposeResizing,
    composeResizeRef,
    composeModalRef,
    composeTextRef,
    composeSelectionRef,
    composeDragDepthRef,
    composeCardRef,
    sendingMail,
    setSendingMail,
    sendingMailRef,
    draftSaving,
    setDraftSaving,
    draftSavedAt,
    setDraftSavedAt,
    draftSaveError,
    setDraftSaveError,
    discardingDraft,
    setDiscardingDraft,
    draftSaveTimerRef,
    draftSaveInFlightRef,
    pendingDraftSaveRef,
    composeSessionVersionRef,
    composeDraftIdRef,
    lastDraftHashRef,
    currentDraftHashRef,
    composeBaselineHashRef,
    composeDirtyRef,
    composeEditorInitRef,
    composeLastEditedRef
  } = compose;

  const composeRef = useRef(compose);
  composeRef.current = compose;

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      // Intentionally read the latest timer at unmount; it may have been
      // replaced after this cleanup was registered.
      if (composeBodyDebounceRef.current) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        clearTimeout(composeBodyDebounceRef.current);
      }
    };
  }, [composeBodyDebounceRef]);

  // Keep the draft-id ref in sync with the state value.
  useEffect(() => {
    composeDraftIdRef.current = composeDraftId;
  }, [composeDraftId, composeDraftIdRef]);

  // Propagate `draftSavedAt` changes so MailClient can drive its
  // "saved N seconds ago" relative-time indicator.
  useEffect(() => {
    onDraftSavedAtChange?.(draftSavedAt);
  }, [draftSavedAt, onDraftSavedAtChange]);

  const selectedSignature =
    accountSignatures.find((signature) => signature.id === composeSignatureId) ?? null;

  const composeTranslation = useComposeTranslation({
    activeAccountId,
    enabled: Boolean(currentAccount?.deepl?.enabled && currentAccount?.deepl?.hasApiKey),
    composeTab,
    composeBody,
    composeHtml,
    composeHtmlText,
    composeTextRef,
    composeMarkdownRef,
    composeBodyDebounceRef,
    composeDirtyRef,
    composeLastEditedRef,
    composeSessionVersionRef,
    setComposeBody,
    setComposeHtml,
    setComposeHtmlText,
    setComposeMarkdown,
    setComposeEditorReset,
    stripHtml,
    apiFetch
  });
  const resetComposeTranslation = composeTranslation.reset;

  const {
    addComposeFiles,
    addDroppedFiles,
    removeComposeAttachment,
    handleInlineImage,
    handleComposeDragEnter,
    handleComposeDragLeave,
    handleComposeDragOver,
    handleComposeDrop,
    handleComposeAttachmentPick,
    loadComposeSourceAttachments
  } = useComposeHandlers({
    composeDirtyRef,
    composeDragDepthRef,
    setComposeDragActive,
    setComposeAttachments,
    setPendingImageDrop,
    apiFetch
  });

  // Prune inline attachments whose referenced data URLs no longer appear in the
  // HTML body — prevents stale inline uploads from being sent.
  useEffect(() => {
    if (composeTab !== "html") return;
    const referencedHtml = `${composeHtml}${
      composeIncludeOriginal && !composeQuotedHtmlEdited ? composeQuotedHtml : ""
    }`;
    setComposeAttachments((prev) => {
      return pruneUnreferencedInlineAttachments(prev, referencedHtml);
    });
  }, [
    composeHtml,
    composeIncludeOriginal,
    composeQuotedHtml,
    composeQuotedHtmlEdited,
    composeTab,
    setComposeAttachments
  ]);

  const currentComposeInviteDraft = useMemo<ComposeInviteDraft | null>(
    () =>
      composeIncludeInvite
        ? normalizeComposeInviteDraft({
            location: composeInviteLocation,
            start: composeInviteStart,
            end: composeInviteEnd,
            allDay: composeInviteAllDay,
            recurrenceRule: composeInviteRecurrenceRule
          })
        : null,
    [
      composeIncludeInvite,
      composeInviteAllDay,
      composeInviteEnd,
      composeInviteLocation,
      composeInviteRecurrenceRule,
      composeInviteStart
    ]
  );

  const {
    applySignatureToCompose,
    buildComposePayload,
    openCompose: openComposeInternal,
    popOutCompose,
    popInCompose,
    minimizeCompose
  } = useComposeController({
    compose,
    currentAccount,
    defaultSignatureId,
    accountDateFormat,
    stripHtml,
    normalizeHtmlDerivedText,
    setDraftSaving,
    setDraftSavedAt,
    setDraftSaveError,
    findMessageByMessageId: (messageId: string) =>
      activeThread.find((msg) => msg.messageId === messageId)
  });

  useComposeViewEffects({
    showComposeInline,
    composeReplyMessageId: composeReplyMessage?.id ?? null,
    composeCardRef,
    composeTab,
    composeOpen,
    composeView,
    composeMode,
    activeFolderId: activeFolderId ?? "",
    composeModalRef,
    composeTextRef,
    composeResizeRef,
    composeResizing,
    setComposeOpen,
    setComposeSize,
    setComposeResizing
  });

  const {
    saveDraft,
    handleDiscardDraft,
    handleSaveDraft,
    saveDraftForHandoff,
    flushPendingDraftSaves
  } = useDraftManager({
    activeAccountId,
    composeOpen,
    composeTab,
    composeTo,
    composeCc,
    composeBcc,
    composeSubject,
    composeInvite: currentComposeInviteDraft,
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
  });

  useComposeDraftAutoSave({
    composeOpen,
    sendingMail,
    draftSaving,
    composeTo,
    composeCc,
    composeBcc,
    composeSubject,
    composeInvite: currentComposeInviteDraft,
    composeBody,
    composeHtml,
    composeHtmlText,
    composeMarkdown,
    composeQuotedHtml,
    composeQuoteHtml,
    composeIncludeOriginal,
    composeStripImages,
    composeQuotedHtmlEdited,
    composeTab,
    composeDraftId,
    composeReplyHeaders,
    composeAttachments,
    lastDraftHashRef,
    currentDraftHashRef,
    composeBaselineHashRef,
    composeDirtyRef,
    composeLastEditedRef,
    draftSaveTimerRef,
    buildComposePayload,
    saveDraft
  });

  const cancelDraftAutoSave = useCallback(() => {
    if (draftSaveTimerRef.current !== null) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    pendingDraftSaveRef.current = null;
    composeSessionVersionRef.current += 1;
    setDraftSaving(false);
  }, [
    composeSessionVersionRef,
    draftSaveTimerRef,
    pendingDraftSaveRef,
    setDraftSaving
  ]);

  const handleDiscardDraftWithCancel = useCallback(async () => {
    if (discardingDraftRequestRef.current || sendingMailRef.current) return;
    discardingDraftRequestRef.current = true;
    // Cancel a pending debounced auto-save before discarding, mirroring the
    // send path. Without this, a timer scheduled just before the user clicks
    // Discard can fire mid-discard and enqueue a fresh save, re-creating the
    // draft after it was discarded. We clear only the timer here (not the
    // session version) so the discard's own `flushPendingDraftSaves` can still
    // settle any already-running save and learn the final draft id; the
    // version bump that neutralizes a late save happens inside the discard.
    const discardedDraftId = composeDraftIdRef.current;
    if (draftSaveTimerRef.current !== null) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    try {
      const discarded = await handleDiscardDraft();
      if (discarded && detachedWindow) {
        onDetachedComposeOutcome?.("discarded", discardedDraftId);
        window.close();
      }
    } finally {
      discardingDraftRequestRef.current = false;
    }
  }, [
    detachedWindow,
    composeDraftIdRef,
    draftSaveTimerRef,
    handleDiscardDraft,
    onDetachedComposeOutcome,
    sendingMailRef
  ]);

  const openComposeInNewWindow = useCallback(async () => {
    if (
      detachedWindow ||
      !activeAccountId ||
      detachingComposeRef.current ||
      sendingMailRef.current ||
      discardingDraftRequestRef.current
    ) return;
    detachingComposeRef.current = true;
    setDetachingCompose(true);
    const handoffId = window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const createdAtMs = Date.now();
    const baseHandoff = {
      version: 1 as const,
      accountId: activeAccountId,
      mode: composeMode,
      sourceMessageId: composeReplyMessage?.id ?? null,
      draftId: composeDraftIdRef.current,
      createdAtMs,
      updatedAtMs: createdAtMs
    };
    try {
      pruneExpiredDetachedComposeHandoffs(createdAtMs);
      writeDetachedComposeHandoff(handoffId, {
        ...baseHandoff,
        status: "preparing"
      });
      const openResult = await openDetachedWindowConfirmed(
        `/compose/window?handoff=${encodeURIComponent(handoffId)}`,
        { width: 1040, height: 840 }
      );
      if (!openResult.opened) {
        removeDetachedComposeHandoff(handoffId);
        pushNotice({
          type: "warning",
          title: "Could not open composer window",
          description: openResult.error
            ? "The desktop window could not be created. Your message remains open here."
            : "Allow pop-ups to open the composer in a new window."
        });
        return;
      }

      const handoff = await saveDraftForHandoff();
      if (!handoff.saved || (handoff.hasContent && !handoff.draftId)) {
        writeDetachedComposeHandoff(handoffId, {
          ...baseHandoff,
          status: "error",
          draftId: handoff.draftId,
          message: "The draft could not be saved before opening the new window.",
          updatedAtMs: Date.now()
        });
        return;
      }
      writeDetachedComposeHandoff(handoffId, {
        ...baseHandoff,
        status: "ready",
        draftId: handoff.draftId,
        updatedAtMs: Date.now()
      });
      cancelDraftAutoSave();
      setComposeOpen(false);
      setComposeView("inline");
    } catch (error) {
      removeDetachedComposeHandoff(handoffId);
      reportError("The composer handoff could not be created.");
      if (error instanceof Error) {
        console.error("[noctua] detached composer handoff failed:", error);
      }
    } finally {
      detachingComposeRef.current = false;
      setDetachingCompose(false);
    }
  }, [
    activeAccountId,
    cancelDraftAutoSave,
    composeDraftIdRef,
    composeMode,
    composeReplyMessage,
    detachedWindow,
    pushNotice,
    reportError,
    saveDraftForHandoff,
    sendingMailRef,
    setComposeOpen,
    setComposeView
  ]);

  const closeDetachedCompose = useCallback(async () => {
    if (
      !detachedWindow ||
      closingDetachedComposeRef.current ||
      sendingMailRef.current ||
      discardingDraftRequestRef.current
    ) return;
    closingDetachedComposeRef.current = true;
    setDetachingCompose(true);
    try {
      const saved = await saveDraftForHandoff();
      if (!saved.saved || (saved.hasContent && !saved.draftId)) {
        reportError("The draft could not be saved. Keep this window open and try again.");
        closingDetachedComposeRef.current = false;
        setDetachingCompose(false);
        return;
      }
      cancelDraftAutoSave();
      onDetachedComposeOutcome?.("saved", saved.draftId);
      window.close();
    } catch {
      closingDetachedComposeRef.current = false;
      setDetachingCompose(false);
      reportError("The draft could not be saved. Keep this window open and try again.");
    }
  }, [
    cancelDraftAutoSave,
    detachedWindow,
    onDetachedComposeOutcome,
    reportError,
    saveDraftForHandoff,
    sendingMailRef
  ]);

  const resetAfterSend = useCallback(() => {
    setComposeOpen(false);
    setComposeDraftId(null);
    setComposeAttachments([]);
    lastDraftHashRef.current = "";
    currentDraftHashRef.current = "";
    composeBaselineHashRef.current = null;
    setComposeView("inline");
    resetComposeTranslation();
  }, [
    composeBaselineHashRef,
    resetComposeTranslation,
    currentDraftHashRef,
    lastDraftHashRef,
    setComposeAttachments,
    setComposeDraftId,
    setComposeOpen,
    setComposeView
  ]);

  const handleSendMail = async () => {
    // The draft flush below can take seconds while an auto-save's IMAP APPEND
    // settles. Claim the send here, synchronously, so clicks landing in that
    // window bail out instead of each starting their own SMTP send — the
    // button's `disabled` alone is too late, it only applies once React has
    // re-rendered.
    if (sendingMailRef.current) return;
    const composeInviteDraft = currentComposeInviteDraft;
    if (!composeTo.trim() && !composeCc.trim() && !composeBcc.trim()) {
      reportError("Please add at least one recipient.");
      return;
    }
    const invitePayload =
      composeIncludeInvite ? buildComposeInvitePayload(composeInviteDraft) : undefined;
    if (composeIncludeInvite && !invitePayload) {
      reportError("Please complete the event invitation details before sending.");
      return;
    }
    sendingMailRef.current = true;
    setSendingMail(true);
    try {
      // Stop new debounced saves from being scheduled, then let any save that
      // is already running (or queued) finish before we touch the draft. A
      // forward/reply auto-saves a draft on open; if its IMAP APPEND is still
      // in flight when send fires, cancelling outright would orphan that draft
      // on the server (the discard below would run against a not-yet-known
      // draft id). Flushing first lets the save settle and populate
      // `composeDraftIdRef`, so the discard can delete both copies.
      if (draftSaveTimerRef.current !== null) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      await flushPendingDraftSaves();
      cancelDraftAutoSave();
      const { text, html, markdown, attachments, composeFormat } = buildComposePayload();
      const smtpPayload = buildSendPayload(composeMode, {
        composeTo,
        composeCc,
        composeBcc,
        composeSubject,
        text,
        markdown,
        html,
        attachments,
        invite: invitePayload ?? undefined,
        composeFormat,
        composeReplyHeaders,
        composeReplyMessage,
        accountFromValue: fromValue
      });
      const res = await apiFetch(buildAccountSmtpSendPath(activeAccountId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(smtpPayload)
      });
      if (res.ok) {
        const sendResult = (await res.json().catch(() => null)) as
          | {
              ok?: boolean;
              sentFolderId?: string | null;
              sentMessageUid?: number | null;
              messageId?: string | null;
              inviteScheduled?: boolean;
              inviteEventId?: string | null;
              inviteWarning?: string | null;
            }
          | null;
        if (composeReplyMessage) {
          const threadId =
            composeReplyMessage.threadId ??
            composeReplyMessage.messageId ??
            composeReplyMessage.id;
          evictThreadCache(threadId);
        }
        // Read the draft id from the ref, not the `composeDraftId` state
        // captured in this closure: the flush above may have just created or
        // updated the draft, and the ref reflects that synchronously while
        // the state value is still stale for this render.
        const sentDraftId = composeDraftIdRef.current;
        if (sentDraftId && activeAccountId) {
          suppressDraftDeleteReconcile(sentDraftId);
          removeDraftFromUi(sentDraftId);
          try {
            await apiFetch(buildAccountDraftDiscardPath(activeAccountId, sentDraftId), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({})
            });
          } catch {
            // ignore draft cleanup errors
          }
        }
        resetAfterSend();
        if (
          (composeMode === "reply" || composeMode === "replyAll") &&
          composeReplyMessage
        ) {
          await updateFlagState(composeReplyMessage, "answered", true);
        }
        if (composeMode === "forward" && composeReplyMessage) {
          await updateKeywordFlag(composeReplyMessage, "$Forwarded", true);
        }
        const sentFolder =
          accountFolders.find((folder) => folder.id === sendResult?.sentFolderId) ?? findSentFolder();
        const sentSyncDecision = decidePostSendSentSync({
          sentFolderId: sentFolder?.id ?? null
        });
        const sentSyncTriggerId = logSyncPolicyCall({
          caller: "post-send-sent-refresh",
          policy: "decidePostSendSentSync",
          accountId: activeAccountId,
          folderId: sentFolder?.id ?? null,
          input: {
            sentFolderId: sentFolder?.id ?? null
          },
          decision: sentSyncDecision
        });
        if (sentSyncDecision.kind === "folder") {
          const sentMessageUid =
            typeof sendResult?.sentMessageUid === "number" && Number.isFinite(sendResult.sentMessageUid)
              ? sendResult.sentMessageUid
              : null;
          await syncFolderWithBackgroundRef.current?.(
            sentSyncDecision.folderId,
            false,
            sentMessageUid !== null ? "new" : sentSyncDecision.mode,
            {
              backfillUids: sentMessageUid !== null ? [sentMessageUid] : undefined,
              fullSyncReason: sentSyncDecision.reason,
              triggerId: sentSyncTriggerId
            }
          );
        }
        await refreshFolders();
        if (sentFolder && activeFolderId === sentFolder.id && searchScope === "folder") {
          await refreshMailboxData();
        }
        if (
          composeReplyMessage &&
          (!sentFolder || activeFolderId !== sentFolder.id || searchScope !== "folder")
        ) {
          await refreshMailboxData();
        }
        clearRecipientSuggestionCache(activeAccountId);
        pushNotice({
          type: "success",
          title: "Email sent.",
          description: composeSubject.trim() ? composeSubject.trim().slice(0, 180) : undefined
        });
        if (sendResult?.inviteWarning) {
          pushNotice({
            type: "warning",
            title: "Invitation email sent",
            description: sendResult.inviteWarning
          });
        }
        if (detachedWindow) {
          onDetachedComposeOutcome?.("sent", sentDraftId);
          window.close();
        }
      } else {
        reportError(await readErrorMessage(res));
      }
    } catch (error) {
      reportError(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Failed to send email."
      );
    } finally {
      sendingMailRef.current = false;
      setSendingMail(false);
    }
  };

  const applyComposePrefill = (prefill: ComposeOpenPrefill) => {
    if (prefill.to) compose.setComposeTo(prefill.to);
    if (prefill.cc) compose.setComposeCc(prefill.cc);
    if (prefill.bcc) {
      compose.setComposeBcc(prefill.bcc);
      compose.setComposeShowBcc(true);
    }
    if (prefill.subject) compose.setComposeSubject(prefill.subject);
    if (prefill.body) {
      compose.setComposeBody(prefill.body);
      // The HTML editor reads from composeHtml — escape minimally so user-entered
      // angle brackets render as text, not as HTML tags.
      const escapedHtml = prefill.body
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
      compose.setComposeHtml(`<p>${escapedHtml}</p>`);
      compose.setComposeHtmlText(prefill.body);
      compose.setComposeMarkdown(prefill.body);
      compose.setComposeEditorReset((prev) => prev + 1);
    }
  };

  const initializeCompose = async (
    mode: ComposeMode,
    message?: Message,
    asNew = false,
    prefill?: ComposeOpenPrefill
  ) => {
    resetComposeTranslation();
    if (!message) {
      openComposeInternal(mode, undefined, asNew);
      if (prefill) applyComposePrefill(prefill);
      return;
    }

    const preferredComposeTab = getPreferredComposeTab(message.id);

    const getComposeSourceMessage = (clickedMessage: Message) => {
      const cachedMessage = messageById.get(clickedMessage.id);
      if (!cachedMessage) return clickedMessage;

      const scoreMessage = (candidate: Message) =>
        (hasHtmlContent(candidate.htmlBody) ? 2 : 0) +
        ((candidate.body ?? "").trim().length > 0 ? 1 : 0);

      return scoreMessage(clickedMessage) >= scoreMessage(cachedMessage)
        ? clickedMessage
        : cachedMessage;
    };

    const hydrateDraftComposeMetadata = async (msg: Message) => {
      if (!isDraftMessage(msg)) return msg;
      if (msg.draftInvite) return msg;
      const source = msg.source ?? (msg.hasSource
        ? await apiFetch(buildAccountMessageSourcePath(msg.accountId, msg.id))
            .then(async (response) => {
              if (!response.ok) return "";
              const data = (await response.json().catch(() => null)) as { source?: string } | null;
              return data?.source ?? "";
            })
            .catch(() => "")
        : "");
      const draftInvite = source ? extractComposeInviteDraftFromSource(source) : null;
      return draftInvite ? { ...msg, source, draftInvite } : msg;
    };

    const afterOpen = async (msg: Message) => {
      const messageWithDraftMetadata = await hydrateDraftComposeMetadata(msg);
      if (mode === "edit" || mode === "forward") {
        const { attachments, message: hydratedMessage } = await loadComposeSourceAttachments(
          messageWithDraftMetadata
        );
        openComposeInternal(mode, hydratedMessage, asNew, { preferredComposeTab });
        setComposeAttachments(attachments);
        return;
      }

      openComposeInternal(mode, messageWithDraftMetadata, asNew, { preferredComposeTab });
    };

    const resolved = getComposeSourceMessage(message);
    const hasText = Boolean((resolved.body ?? "").trim());
    const hasHtml = hasHtmlContent(resolved.htmlBody);
    if (hasText || hasHtml) {
      await afterOpen(resolved);
      return;
    }

    const hydrated = await ensureMessageContent(resolved, { manual: true });
    await afterOpen(hydrated ?? resolved);
  };

  // Most UI entry points intentionally open compose fire-and-forget. Keep that
  // public action rejection-safe while allowing the detached-window bootstrap
  // below to observe initialization failures and replace its loading surface
  // with an error state.
  const openCompose = async (
    mode: ComposeMode,
    message?: Message,
    asNew = false,
    prefill?: ComposeOpenPrefill
  ) => {
    try {
      await initializeCompose(mode, message, asNew, prefill);
    } catch (error) {
      console.error("[noctua] failed to open composer:", error);
      reportError(
        error instanceof Error && error.message.trim()
          ? `Failed to open composer: ${error.message}`
          : "Failed to open composer."
      );
    }
  };

  const openDetachedCompose = async (
    draft: Message | null,
    context: { mode: ComposeMode; sourceMessage: Message | null }
  ) => {
    if (!draft) {
      await initializeCompose(context.mode, context.sourceMessage ?? undefined);
    } else {
      // Draft fields and attachments must be initialized through edit mode,
      // but reply/forward behavior is semantic state that is not encoded
      // completely in the RFC draft. Restore it explicitly after hydration.
      await initializeCompose("edit", draft);
      compose.setComposeMode(context.mode);
      compose.setComposeReplyMessage(context.sourceMessage);
    }
    setComposeView("inline");
  };

  const currentDraftChangeState = (() => {
    const preferText = composeTab === "html" && composeLastEditedRef.current === "text";
    const composePayload = buildComposePayload({ preferText });
    return getDraftChangeState({
      draftId: composeDraftId,
      lastSavedHash: lastDraftHashRef.current,
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
      subject: composeSubject,
      text: composePayload.text,
      html: composePayload.html,
      attachments: composePayload.attachments,
      invite: currentComposeInviteDraft
    });
  })();
  const canSaveCurrentDraft =
    composeOpen && Boolean(composeDraftId) && currentDraftChangeState.canManualSave;
  const hasUnsavedChanges =
    composeOpen &&
    composeDirtyRef.current &&
    (currentDraftChangeState.hasContent || Boolean(composeDraftId));

  // Mirror the slice of compose state consumed by the owning window. The
  // detached host also uses the persistence flags for native-close protection.
  useEffect(() => {
    onComposeMirrorChange?.({
      composeOpen,
      composeView,
      composeMode,
      composeDraftId,
      composeReplyMessage,
      hasUnsavedChanges,
      draftSaving,
      sendingMail,
      discardingDraft
    });
  }, [
    composeOpen,
    composeView,
    composeMode,
    composeDraftId,
    composeReplyMessage,
    hasUnsavedChanges,
    draftSaving,
    sendingMail,
    discardingDraft,
    onComposeMirrorChange
  ]);

  const markComposeDirty = useCallback(() => {
    composeDirtyRef.current = true;
  }, [composeDirtyRef]);

  const jumpToMessage = useCallback(
    (messageId: string) => {
      const msg = messageById.get(messageId) ?? null;
      setViewMessage(msg);
      setActiveMessageId(messageId);
    },
    [messageById, setActiveMessageId, setViewMessage]
  );

  const jumpToMessageFromModal = useCallback(
    (messageId: string) => {
      jumpToMessage(messageId);
      setComposeView("inline");
    },
    [jumpToMessage, setComposeView]
  );

  const visibleComposeAttachments = composeAttachments.filter((item) => !item.inline);

  const composeMessageField = (
    <ComposeMessageField
      darkMode={darkMode}
      composeMode={composeMode}
      composeTab={composeTab}
      composeBody={composeBody}
      composeHtml={composeHtml}
      composeHtmlText={composeHtmlText}
      composeMarkdown={composeMarkdown}
      composeInvite={currentComposeInviteDraft}
      composeIncludeOriginal={composeIncludeOriginal}
      composeQuoteHtml={composeQuoteHtml}
      composeQuotedHtml={composeQuotedHtml}
      composeQuotedText={composeQuotedText}
      composeQuotedParts={composeQuotedParts}
      composeStripImages={composeStripImages}
      composeEditorReset={composeEditorReset}
      visibleComposeAttachments={visibleComposeAttachments}
      composeTranslation={composeTranslation.ui}
      onComposeTranslate={composeTranslation.translate}
      onComposeTranslateRevert={composeTranslation.revert}
      onComposeTranslateDismiss={composeTranslation.dismissError}
      onComposeTranslateLangChange={composeTranslation.setTargetLang}
      composeSignatureId={composeSignatureId}
      signatureMenuOpen={signatureMenuOpen}
      selectedSignature={selectedSignature}
      accountSignatures={accountSignatures}
      composeTextRef={composeTextRef}
      composeBodyDebounceRef={composeBodyDebounceRef}
      composeBodyLastUpdateRef={composeBodyLastUpdateRef}
      composeMarkdownRef={composeMarkdownRef}
      composeDirtyRef={composeDirtyRef}
      composeEditorInitRef={composeEditorInitRef}
      composeLastEditedRef={composeLastEditedRef}
      composeSessionVersionRef={composeSessionVersionRef}
      stripHtml={stripHtml}
      setComposeBody={setComposeBody}
      setComposeHtml={setComposeHtml}
      setComposeHtmlText={setComposeHtmlText}
      setComposeMarkdown={setComposeMarkdown}
      setComposeInviteEnabled={(enabled) => {
        setComposeIncludeInvite(enabled);
        if (!enabled) {
          setComposeInviteLocation("");
          setComposeInviteStart("");
          setComposeInviteEnd("");
          setComposeInviteAllDay(false);
          setComposeInviteRecurrenceRule("");
          composeDirtyRef.current = true;
          return;
        }
        const nextDraft = createDefaultComposeInviteDraft();
        setComposeInviteLocation(nextDraft.location ?? "");
        setComposeInviteStart(nextDraft.start);
        setComposeInviteEnd(nextDraft.end);
        setComposeInviteAllDay(nextDraft.allDay);
        setComposeInviteRecurrenceRule(nextDraft.recurrenceRule ?? "");
        composeDirtyRef.current = true;
      }}
      setComposeInviteLocation={(value) => {
        setComposeInviteLocation(value);
        composeDirtyRef.current = true;
      }}
      setComposeInviteStart={(value) => {
        setComposeInviteStart(value);
        composeDirtyRef.current = true;
      }}
      setComposeInviteEnd={(value) => {
        setComposeInviteEnd(value);
        composeDirtyRef.current = true;
      }}
      setComposeInviteAllDay={(value) => {
        setComposeInviteAllDay(value);
        composeDirtyRef.current = true;
      }}
      setComposeInviteRecurrenceRule={(value) => {
        setComposeInviteRecurrenceRule(value);
        composeDirtyRef.current = true;
      }}
      setComposeTab={setComposeTab}
      setComposeEditorReset={setComposeEditorReset}
      setComposeIncludeOriginal={setComposeIncludeOriginal}
      setComposeQuoteHtml={setComposeQuoteHtml}
      setComposeQuotedHtml={setComposeQuotedHtml}
      setComposeQuotedText={setComposeQuotedText}
      setComposeQuotedHtmlEdited={compose.setComposeQuotedHtmlEdited}
      setComposeQuotedParts={setComposeQuotedParts}
      setComposeStripImages={setComposeStripImages}
      setComposeSignatureId={setComposeSignatureId}
      setSignatureMenuOpen={setSignatureMenuOpen}
      applySignatureToCompose={applySignatureToCompose}
      handleInlineImage={handleInlineImage}
      handleComposeAttachmentPick={handleComposeAttachmentPick}
      removeComposeAttachment={removeComposeAttachment}
      pendingImageDrop={pendingImageDrop}
      setPendingImageDrop={setPendingImageDrop}
      addComposeFiles={addComposeFiles}
      addDroppedFiles={addDroppedFiles}
    />
  );

  const contextValue: ComposeContextValue = {
    composeOpen,
    composeView,
    composeMode,
    composeDraftId,
    composeTo,
    composeCc,
    composeBcc,
    composeSubject,
    composeShowBcc,
    composeOpenedAt,
    activeAccountId,
    fromValue,
    inReplyToMessage: composeReplyMessage,
    composeInviteDraft: currentComposeInviteDraft,
    composeFieldsReset: composeEditorReset,
    composeDragActive,
    composeSize,
    canSaveDraft: canSaveCurrentDraft,
    draftSaving,
    draftSaveError,
    draftSavedAt,
    sendingMail,
    discardingDraft,
    detachingCompose,
    detachedWindow,
    composeModalRef,
    composeResizeRef,
    setComposeTo,
    setComposeCc,
    setComposeBcc,
    setComposeSubject,
    setComposeShowBcc,
    setComposeOpen,
    setComposeView,
    setComposeResizing,
    setComposeAttachments,
    popOutCompose,
    popInCompose,
    minimizeCompose,
    openComposeInNewWindow,
    closeDetachedCompose,
    handleSendMail,
    handleSaveDraft,
    handleDiscardDraft: handleDiscardDraftWithCancel,
    markComposeDirty,
    applyRecipientSelection,
    loadRecipientOptions,
    jumpToMessage: jumpToMessageFromModal,
    getComposeToken,
    formatRelativeTime,
    handleComposeDragEnter,
    handleComposeDragLeave,
    handleComposeDragOver,
    handleComposeDrop,
    composeMessageField,
    composeCardRef
  };

  // Inline card variant uses `jumpToMessage` (no view switch) while the modal
  // variant docks back into the thread view after jumping.
  const inlineContextValue: ComposeContextValue = { ...contextValue, jumpToMessage };

  // The inline card stays in this component's render tree so state updates
  // propagate via context; its DOM is portalled into a caller-supplied slot.
  const [inlineSlotEl, setInlineSlotEl] = useState<HTMLDivElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      renderInlineCard: (wrapperClassName?: string) => (
        <InlineComposeSlot
          wrapperClassName={wrapperClassName}
          setSlot={setInlineSlotEl}
          externalRef={composeCardRef}
        />
      ),
      resetSession: () => {
        resetComposeSession(composeRef.current);
        resetComposeTranslation();
      },
      openCompose,
      openDetachedCompose,
      setComposeView
    })
  );

  return (
    <ComposeContextProvider value={contextValue}>
      <ComposeModal open={showComposeModal} />
      <ComposeMinimized open={showComposeMinimized} />
      {inlineSlotEl &&
        createPortal(
          <ComposeContextProvider value={inlineContextValue}>
            <ComposeInlineCard />
          </ComposeContextProvider>,
          inlineSlotEl
        )}
    </ComposeContextProvider>
  );
}

function InlineComposeSlot({
  wrapperClassName,
  setSlot,
  externalRef
}: {
  wrapperClassName?: string;
  setSlot: (el: HTMLDivElement | null) => void;
  externalRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      externalRef.current = el;
      setSlot(el);
    },
    [externalRef, setSlot]
  );
  return <div ref={setRef} className={wrapperClassName} />;
}

const ComposeOrchestrator = forwardRef<ComposeOrchestratorHandle, ComposeOrchestratorProps>(
  ComposeOrchestratorImpl
);
ComposeOrchestrator.displayName = "ComposeOrchestrator";

export default ComposeOrchestrator;
