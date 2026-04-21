import type { ComposeState } from "./useComposeState";

type ResettableComposeState = Pick<
  ComposeState,
  | "setComposeOpen"
  | "setComposeView"
  | "setComposeDraftId"
  | "setComposeMode"
  | "setComposeTo"
  | "setComposeCc"
  | "setComposeBcc"
  | "setComposeSubject"
  | "setComposeBody"
  | "setComposeIncludeInvite"
  | "setComposeInviteLocation"
  | "setComposeInviteStart"
  | "setComposeInviteEnd"
  | "setComposeInviteAllDay"
  | "setComposeInviteRecurrenceRule"
  | "setComposeHtml"
  | "setComposeHtmlText"
  | "setComposeMarkdown"
  | "composeMarkdownRef"
  | "setComposeOpenedAt"
  | "setComposeSignatureId"
  | "setSignatureMenuOpen"
  | "setComposeReplyMessage"
  | "setComposeTab"
  | "setComposeShowBcc"
  | "setComposeStripImages"
  | "setComposeIncludeOriginal"
  | "setComposeQuoteHtml"
  | "setComposeQuotedHtml"
  | "setComposeQuotedText"
  | "setComposeQuotedHtmlEdited"
  | "setComposeReplyHeaders"
  | "setComposeAttachments"
  | "setComposeDragActive"
  | "setComposeEditorReset"
  | "setComposeQuotedParts"
  | "setComposeResizing"
  | "setSendingMail"
  | "setDraftSaving"
  | "setDraftSavedAt"
  | "setDraftSaveError"
  | "setDiscardingDraft"
  | "composeBodyDebounceRef"
  | "draftSaveTimerRef"
  | "draftSaveInFlightRef"
  | "pendingDraftSaveRef"
  | "composeSessionVersionRef"
  | "composeDraftIdRef"
  | "lastDraftHashRef"
  | "currentDraftHashRef"
  | "composeBaselineHashRef"
  | "composeDirtyRef"
  | "composeEditorInitRef"
  | "composeLastEditedRef"
  | "composeSignatureRef"
  | "composeSelectionRef"
  | "composeDragDepthRef"
  | "composeResizeRef"
>;

export function resetComposeSession(compose: ResettableComposeState) {
  if (compose.composeBodyDebounceRef.current) {
    clearTimeout(compose.composeBodyDebounceRef.current);
    compose.composeBodyDebounceRef.current = null;
  }
  if (compose.draftSaveTimerRef.current !== null) {
    clearTimeout(compose.draftSaveTimerRef.current);
    compose.draftSaveTimerRef.current = null;
  }

  compose.draftSaveInFlightRef.current = false;
  compose.pendingDraftSaveRef.current = null;
  compose.composeSessionVersionRef.current += 1;
  compose.composeDraftIdRef.current = null;
  compose.lastDraftHashRef.current = "";
  compose.currentDraftHashRef.current = "";
  compose.composeBaselineHashRef.current = null;
  compose.composeDirtyRef.current = false;
  compose.composeEditorInitRef.current = false;
  compose.composeLastEditedRef.current = "html";
  compose.composeSignatureRef.current = null;
  compose.composeSelectionRef.current = null;
  compose.composeDragDepthRef.current = 0;
  compose.composeResizeRef.current = null;
  compose.composeMarkdownRef.current = "";

  compose.setComposeOpen(false);
  compose.setComposeView("inline");
  compose.setComposeDraftId(null);
  compose.setComposeMode("new");
  compose.setComposeTo("");
  compose.setComposeCc("");
  compose.setComposeBcc("");
  compose.setComposeSubject("");
  compose.setComposeBody("");
  compose.setComposeIncludeInvite(false);
  compose.setComposeInviteLocation("");
  compose.setComposeInviteStart("");
  compose.setComposeInviteEnd("");
  compose.setComposeInviteAllDay(false);
  compose.setComposeInviteRecurrenceRule("");
  compose.setComposeHtml("");
  compose.setComposeHtmlText("");
  compose.setComposeMarkdown("");
  compose.setComposeOpenedAt("");
  compose.setComposeSignatureId("");
  compose.setSignatureMenuOpen(false);
  compose.setComposeReplyMessage(null);
  compose.setComposeTab("html");
  compose.setComposeShowBcc(false);
  compose.setComposeStripImages(false);
  compose.setComposeIncludeOriginal(true);
  compose.setComposeQuoteHtml(true);
  compose.setComposeQuotedHtml("");
  compose.setComposeQuotedText("");
  compose.setComposeQuotedHtmlEdited(false);
  compose.setComposeReplyHeaders(null);
  compose.setComposeAttachments([]);
  compose.setComposeDragActive(false);
  compose.setComposeEditorReset((prev) => prev + 1);
  compose.setComposeQuotedParts(null);
  compose.setComposeResizing(false);
  compose.setSendingMail(false);
  compose.setDraftSaving(false);
  compose.setDraftSavedAt(null);
  compose.setDraftSaveError(null);
  compose.setDiscardingDraft(false);
}

export type { ResettableComposeState };
