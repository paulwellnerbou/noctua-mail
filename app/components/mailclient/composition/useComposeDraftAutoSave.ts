import { useEffect, useRef } from "react";
import type { ComposeInviteDraft } from "@/lib/composeInvite";
import type { Attachment } from "@/lib/data";
import type { ComposePayload } from "./composeContentBuilder";
import { getDraftAutoSaveState } from "./draftAutoSaveState";
import { buildDraftSavePayload, getDraftChangeState } from "./draftSaveUtils";
import type { ComposeReplyHeaders, ComposeTab, DraftSavePayload } from "./composeTypes";

export type UseComposeDraftAutoSaveParams = {
  composeOpen: boolean;
  sendingMail: boolean;
  draftSaving: boolean;
  composeTo: string;
  composeCc: string;
  composeBcc: string;
  composeSubject: string;
  composeInvite?: ComposeInviteDraft | null;
  composeBody: string;
  composeHtml: string;
  composeHtmlText: string;
  composeMarkdown: string;
  composeQuotedHtml: string;
  composeIncludeOriginal: boolean;
  composeStripImages: boolean;
  composeQuotedHtmlEdited: boolean;
  composeTab: ComposeTab;
  composeDraftId: string | null;
  composeReplyHeaders: ComposeReplyHeaders | null;
  composeAttachments: Attachment[];
  lastDraftHashRef: React.MutableRefObject<string>;
  currentDraftHashRef: React.MutableRefObject<string>;
  composeBaselineHashRef: React.MutableRefObject<string | null>;
  composeDirtyRef: React.MutableRefObject<boolean>;
  composeLastEditedRef: React.MutableRefObject<ComposeTab>;
  draftSaveTimerRef: React.MutableRefObject<number | null>;
  buildComposePayload: (options?: { preferText?: boolean }) => ComposePayload;
  saveDraft: (payload: DraftSavePayload, hash: string) => void;
};

export function useComposeDraftAutoSave({
  composeOpen,
  sendingMail,
  draftSaving,
  composeTo,
  composeCc,
  composeBcc,
  composeSubject,
  composeInvite,
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
}: UseComposeDraftAutoSaveParams) {
  // Keep a stable ref to saveDraft so the setTimeout callback never goes stale.
  const saveDraftRef = useRef(saveDraft);
  useEffect(() => {
    saveDraftRef.current = saveDraft;
  }, [saveDraft]);

  // Keep a stable ref to buildComposePayload for the same reason.
  const buildComposePayloadRef = useRef(buildComposePayload);
  useEffect(() => {
    buildComposePayloadRef.current = buildComposePayload;
  }, [buildComposePayload]);

  const previousDraftSavingRef = useRef(false);

  useEffect(() => {
    const previousDraftSaving = previousDraftSavingRef.current;
    previousDraftSavingRef.current = draftSaving;

    if (!composeOpen || sendingMail) return;
    const preferText = composeTab === "html" && composeLastEditedRef.current === "text";
    const composePayload = buildComposePayloadRef.current({ preferText });
    const { text, html, attachments } = composePayload;
    const draftChangeState = getDraftChangeState({
      draftId: composeDraftId,
      lastSavedHash: lastDraftHashRef.current,
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
      subject: composeSubject,
      text,
      html,
      attachments,
      invite: composeInvite
    });
    currentDraftHashRef.current = draftChangeState.hash;

    const autoSaveState = getDraftAutoSaveState({
      baselineHash: composeBaselineHashRef.current,
      composeDraftId,
      composeDirty: composeDirtyRef.current,
      previousDraftSaving,
      draftSaving,
      hash: draftChangeState.hash,
      lastSavedHash: lastDraftHashRef.current,
      canAutoSave: draftChangeState.canAutoSave
    });

    if (autoSaveState.initializeBaseline) {
      composeBaselineHashRef.current = draftChangeState.hash;
      if (autoSaveState.syncLastSavedHashToCurrent) {
        lastDraftHashRef.current = draftChangeState.hash;
      }
      return;
    }

    composeDirtyRef.current = autoSaveState.nextComposeDirty;
    if (autoSaveState.shouldClearDirty || !autoSaveState.shouldScheduleSave) {
      return;
    }

    if (draftSaveTimerRef.current) {
      window.clearTimeout(draftSaveTimerRef.current);
    }
    draftSaveTimerRef.current = window.setTimeout(() => {
      const nextPreferText = composeTab === "html" && composeLastEditedRef.current === "text";
      const nextComposePayload = buildComposePayloadRef.current({ preferText: nextPreferText });
      const nextDraftChangeState = getDraftChangeState({
        draftId: composeDraftId,
        lastSavedHash: lastDraftHashRef.current,
        to: composeTo,
        cc: composeCc,
        bcc: composeBcc,
        subject: composeSubject,
        text: nextComposePayload.text,
        html: nextComposePayload.html,
        attachments: nextComposePayload.attachments,
        invite: composeInvite
      });
      currentDraftHashRef.current = nextDraftChangeState.hash;
      if (!nextDraftChangeState.canAutoSave) {
        if (nextDraftChangeState.hash === lastDraftHashRef.current) {
          composeDirtyRef.current = false;
        }
        return;
      }
      saveDraftRef.current(
        buildDraftSavePayload(
          {
            to: composeTo,
            cc: composeCc,
            bcc: composeBcc,
            subject: composeSubject,
            composeQuotedHtmlEdited,
            composeReplyHeaders,
            invite: composeInvite
          },
          nextComposePayload,
          { preserveUndefinedHtml: true }
        ),
        nextDraftChangeState.hash
      );
    }, 2000);
    return () => {
      if (draftSaveTimerRef.current) {
        window.clearTimeout(draftSaveTimerRef.current);
      }
    };
  }, [
    composeOpen,
    sendingMail,
    draftSaving,
    composeTo,
    composeCc,
    composeBcc,
    composeSubject,
    composeInvite,
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
    composeBaselineHashRef,
    currentDraftHashRef,
    composeDirtyRef,
    composeLastEditedRef,
    draftSaveTimerRef,
    lastDraftHashRef,
  ]);
}
