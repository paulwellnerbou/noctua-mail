"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef
} from "react";
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
  restoreComposeMessageAttachmentDataUrls,
  useComposeHandlers
} from "./useComposeHandlers";
import { useComposeState } from "./useComposeState";
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
   * to the underlying controller.
   */
  openCompose: (mode: ComposeMode, message?: Message, asNew?: boolean) => void;
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
    onComposeMirrorChange
  }: ComposeOrchestratorProps,
  ref: React.ForwardedRef<ComposeOrchestratorHandle>
) {
  const compose = useComposeState();
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
    composeAttachmentInputRef,
    composeCardRef,
    sendingMail,
    setSendingMail,
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
      if (composeBodyDebounceRef.current) {
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

  // Mirror the slice of compose state that MailClient consumes reactively.
  useEffect(() => {
    onComposeMirrorChange?.({
      composeOpen,
      composeView,
      composeMode,
      composeDraftId,
      composeReplyMessage
    });
  }, [
    composeOpen,
    composeView,
    composeMode,
    composeDraftId,
    composeReplyMessage,
    onComposeMirrorChange
  ]);

  const selectedSignature =
    accountSignatures.find((signature) => signature.id === composeSignatureId) ?? null;

  const {
    removeComposeAttachment,
    handleInlineImage,
    handleComposeDragEnter,
    handleComposeDragLeave,
    handleComposeDragOver,
    handleComposeDrop,
    handleComposeAttachmentPick,
    hydrateComposeAttachments,
    loadForwardAttachments
  } = useComposeHandlers({
    composeDirtyRef,
    composeDragDepthRef,
    setComposeDragActive,
    setComposeAttachments,
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

  const { saveDraft, handleDiscardDraft, handleSaveDraft } = useDraftManager({
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

  const resetAfterSend = useCallback(() => {
    setComposeOpen(false);
    setComposeDraftId(null);
    setComposeAttachments([]);
    lastDraftHashRef.current = "";
    currentDraftHashRef.current = "";
    composeBaselineHashRef.current = null;
    setComposeView("inline");
  }, [
    composeBaselineHashRef,
    currentDraftHashRef,
    lastDraftHashRef,
    setComposeAttachments,
    setComposeDraftId,
    setComposeOpen,
    setComposeView
  ]);

  const handleSendMail = async () => {
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
    cancelDraftAutoSave();
    setSendingMail(true);
    try {
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
        if (composeDraftId && activeAccountId) {
          suppressDraftDeleteReconcile(composeDraftId);
          removeDraftFromUi(composeDraftId);
          try {
            await apiFetch(buildAccountDraftDiscardPath(activeAccountId, composeDraftId), {
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
          updateFlagState(composeReplyMessage, "answered", true);
        }
        if (composeMode === "forward" && composeReplyMessage) {
          updateKeywordFlag(composeReplyMessage, "$Forwarded", true);
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
      } else {
        reportError(await readErrorMessage(res));
      }
    } catch {
      reportError("Failed to send email.");
    } finally {
      setSendingMail(false);
    }
  };

  const openCompose = (mode: ComposeMode, message?: Message, asNew = false) => {
    if (!message) {
      openComposeInternal(mode, undefined, asNew);
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
      if (mode === "edit" && (msg.attachments?.length ?? 0) > 0) {
        const attachments = await hydrateComposeAttachments(messageWithDraftMetadata);
        const hydratedMessage = restoreComposeMessageAttachmentDataUrls(
          messageWithDraftMetadata,
          attachments
        );
        openComposeInternal(mode, hydratedMessage, asNew, { preferredComposeTab });
        setComposeAttachments(attachments);
        return;
      }

      if (mode === "forward") {
        const { attachments, message: hydratedForwardMessage } = await loadForwardAttachments(
          messageWithDraftMetadata
        );
        openComposeInternal(mode, hydratedForwardMessage, asNew, { preferredComposeTab });
        setComposeAttachments(attachments);
        return;
      }

      openComposeInternal(mode, messageWithDraftMetadata, asNew, { preferredComposeTab });
    };

    const resolved = getComposeSourceMessage(message);
    const hasText = Boolean((resolved.body ?? "").trim());
    const hasHtml = hasHtmlContent(resolved.htmlBody);
    if (hasText || hasHtml) {
      void afterOpen(resolved);
      return;
    }

    void (async () => {
      const hydrated = await ensureMessageContent(resolved, { manual: true });
      await afterOpen(hydrated ?? resolved);
    })();
  };

  const canSaveCurrentDraft = (() => {
    if (!composeOpen || !composeDraftId) return false;
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
    }).canManualSave;
  })();

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
      composeSignatureId={composeSignatureId}
      signatureMenuOpen={signatureMenuOpen}
      selectedSignature={selectedSignature}
      accountSignatures={accountSignatures}
      composeTextRef={composeTextRef}
      composeAttachmentInputRef={composeAttachmentInputRef}
      composeBodyDebounceRef={composeBodyDebounceRef}
      composeBodyLastUpdateRef={composeBodyLastUpdateRef}
      composeDirtyRef={composeDirtyRef}
      composeEditorInitRef={composeEditorInitRef}
      composeLastEditedRef={composeLastEditedRef}
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
    handleSendMail,
    handleSaveDraft,
    handleDiscardDraft,
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
  const inlineContextValue = useMemo<ComposeContextValue>(
    () => ({ ...contextValue, jumpToMessage }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contextValue, jumpToMessage]
  );

  useImperativeHandle(
    ref,
    () => ({
      renderInlineCard: (wrapperClassName?: string) => (
        <ComposeContextProvider value={inlineContextValue}>
          <div ref={composeCardRef} className={wrapperClassName}>
            <ComposeInlineCard />
          </div>
        </ComposeContextProvider>
      ),
      resetSession: () => {
        resetComposeSession(composeRef.current);
      },
      openCompose,
      setComposeView
    }),
    [
      inlineContextValue,
      composeCardRef,
      openCompose,
      setComposeView
    ]
  );

  return (
    <ComposeContextProvider value={contextValue}>
      <ComposeModal open={showComposeModal} />
      <ComposeMinimized open={showComposeMinimized} />
    </ComposeContextProvider>
  );
}

const ComposeOrchestrator = forwardRef<ComposeOrchestratorHandle, ComposeOrchestratorProps>(
  ComposeOrchestratorImpl
);
ComposeOrchestrator.displayName = "ComposeOrchestrator";

export default ComposeOrchestrator;
