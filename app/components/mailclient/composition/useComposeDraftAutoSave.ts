import { useEffect, useRef } from "react";
import type { Attachment } from "@/lib/data";
import type { ComposePayload } from "./composeContentBuilder";
import { buildDraftSavePayload, computeDraftHash, hasDraftContent } from "./draftSaveUtils";
import type { ComposeReplyHeaders, ComposeTab, DraftSavePayload } from "./composeTypes";

export type UseComposeDraftAutoSaveParams = {
  composeOpen: boolean;
  sendingMail: boolean;
  composeTo: string;
  composeCc: string;
  composeBcc: string;
  composeSubject: string;
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
  composeTo,
  composeCc,
  composeBcc,
  composeSubject,
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

  useEffect(() => {
    if (!composeOpen || sendingMail) return;
    const preferText = composeTab === "html" && composeLastEditedRef.current === "text";
    const composePayload = buildComposePayloadRef.current({ preferText });
    const { text, html, attachments } = composePayload;
    const hasContent = hasDraftContent({
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
      subject: composeSubject,
      text,
      html
    });
    if (!hasContent) return;
    const hash = computeDraftHash({
      to: composeTo,
      cc: composeCc,
      bcc: composeBcc,
      subject: composeSubject,
      text,
      html,
      attachments
    });
    currentDraftHashRef.current = hash;
    if (composeBaselineHashRef.current === null) {
      composeBaselineHashRef.current = hash;
      if (composeDraftId && !composeDirtyRef.current) {
        lastDraftHashRef.current = hash;
      }
      return;
    }
    if (hash === lastDraftHashRef.current) {
      composeDirtyRef.current = false;
      return;
    }
    if (!composeDirtyRef.current) {
      return;
    }
    if (draftSaveTimerRef.current) {
      window.clearTimeout(draftSaveTimerRef.current);
    }
    draftSaveTimerRef.current = window.setTimeout(() => {
      saveDraftRef.current(
        buildDraftSavePayload(
          {
            to: composeTo,
            cc: composeCc,
            bcc: composeBcc,
            subject: composeSubject,
            composeQuotedHtmlEdited,
            composeReplyHeaders
          },
          composePayload,
          { preserveUndefinedHtml: true }
        ),
        hash
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
    composeTo,
    composeCc,
    composeBcc,
    composeSubject,
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
    composeDirtyRef,
    composeLastEditedRef,
    draftSaveTimerRef,
    lastDraftHashRef,
  ]);
}
