import type React from "react";
import type { Account, AccountDateFormat, Message } from "@/lib/data";
import { formatAccountMediumDateTime } from "@/lib/dateFormatting";
import { escapeHtml } from "@/lib/html";
import { buildComposePayload as buildComposePayloadFn } from "./composeContentBuilder";
import { computeComposeInitState } from "./composeInitState";
import type { ComposeMode, ComposeTab } from "./composeTypes";
import type { ComposeState } from "./useComposeState";

type UseComposeControllerParams = {
  compose: ComposeState;
  currentAccount: Account | null;
  defaultSignatureId: string;
  accountDateFormat: AccountDateFormat;
  stripHtml: (value: string) => string;
  normalizeHtmlDerivedText: (value: string) => string;
  setDraftSaving: React.Dispatch<React.SetStateAction<boolean>>;
  setDraftSavedAt: React.Dispatch<React.SetStateAction<number | null>>;
  setDraftSaveError: React.Dispatch<React.SetStateAction<string | null>>;
  findMessageByMessageId?: (messageId: string) => Message | undefined;
};

export function useComposeController({
  compose,
  currentAccount,
  defaultSignatureId,
  accountDateFormat,
  stripHtml,
  normalizeHtmlDerivedText,
  setDraftSaving,
  setDraftSavedAt,
  setDraftSaveError,
  findMessageByMessageId
}: UseComposeControllerParams) {
  const {
    composeDirtyRef,
    composeSignatureRef,
    lastDraftHashRef,
    currentDraftHashRef,
    composeBaselineHashRef,
    composeEditorInitRef,
    composeLastEditedRef
  } = compose;

  const getSignatureBlocks = (body: string) => {
    const text = body.trim();
    if (!text) return { text: "", html: "" };
    return {
      text,
      html: `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`
    };
  };

  const applySignatureToCompose = (signature: { id: string; body: string } | null) => {
    const next = signature ? getSignatureBlocks(signature.body) : { text: "", html: "" };
    const previous = composeSignatureRef.current;
    if (compose.composeTab === "text") {
      compose.setComposeBody((prev) => {
        let base = prev;
        if (previous?.text && base.trimEnd().endsWith(previous.text)) {
          base = base.trimEnd().slice(0, -previous.text.length).trimEnd();
        }
        if (!signature || !next.text) {
          return base;
        }
        const glue = base ? "\n\n" : "";
        return `${base}${glue}${next.text}`;
      });
      compose.setComposeEditorReset((prev) => prev + 1);
    } else if (compose.composeTab === "markdown") {
      compose.setComposeMarkdown((prev) => {
        let base = prev;
        if (previous?.text && base.trimEnd().endsWith(previous.text)) {
          base = base.trimEnd().slice(0, -previous.text.length).trimEnd();
        }
        if (!signature || !next.text) {
          return base;
        }
        const glue = base ? "\n\n" : "";
        return `${base}${glue}${next.text}`;
      });
      compose.setComposeEditorReset((prev) => prev + 1);
    } else {
      compose.setComposeHtml((prev) => {
        let base = prev;
        if (previous?.html && base.trimEnd().endsWith(previous.html)) {
          base = base.trimEnd().slice(0, -previous.html.length).trimEnd();
        }
        if (!signature || !next.html) {
          return base;
        }
        return `${base}${next.html}`;
      });
      compose.setComposeHtmlText((prev) => {
        let base = prev;
        if (previous?.text && base.trimEnd().endsWith(previous.text)) {
          base = base.trimEnd().slice(0, -previous.text.length).trimEnd();
        }
        if (!signature || !next.text) {
          return base;
        }
        const glue = base ? "\n\n" : "";
        return `${base}${glue}${next.text}`;
      });
      compose.setComposeEditorReset((prev) => prev + 1);
    }
    composeDirtyRef.current = true;
    composeSignatureRef.current = signature
      ? { id: signature.id, text: next.text, html: next.html }
      : null;
  };

  const buildComposePayload = (options?: { preferText?: boolean }) => {
    return buildComposePayloadFn(
      {
        composeTab: compose.composeTab,
        composeBody: compose.composeTextRef.current?.value || compose.composeBody,
        composeHtml: compose.composeHtml,
        composeMarkdown: compose.composeMarkdownRef.current,
        composeQuotedHtml: compose.composeQuotedHtml,
        composeQuotedHtmlEdited: compose.composeQuotedHtmlEdited,
        composeIncludeOriginal: compose.composeIncludeOriginal,
        composeStripImages: compose.composeStripImages,
        composeAttachments: compose.composeAttachments
      },
      { stripHtml, normalizeHtmlDerivedText },
      options
    );
  };

  const openCompose = (
    mode: ComposeMode,
    message?: Message,
    asNew = false,
    options?: { preferredComposeTab?: ComposeTab }
  ) => {
    // Reset refs and async state
    lastDraftHashRef.current = "";
    currentDraftHashRef.current = "";
    composeBaselineHashRef.current = null;
    composeDirtyRef.current = false;
    composeEditorInitRef.current = false;
    if (compose.draftSaveTimerRef.current !== null) {
      clearTimeout(compose.draftSaveTimerRef.current);
      compose.draftSaveTimerRef.current = null;
    }
    compose.pendingDraftSaveRef.current = null;
    compose.composeSessionVersionRef.current += 1;
    setDraftSaving(false);
    setDraftSavedAt(null);
    setDraftSaveError(null);
    composeSignatureRef.current = null;

    // Reset shared state
    compose.setComposeEditorReset((prev) => prev + 1);
    compose.setComposeAttachments([]);
    compose.setComposeDragActive(false);
    compose.setComposeMode(mode);
    compose.setComposeOpenedAt(formatAccountMediumDateTime(Date.now(), accountDateFormat) ?? "");
    compose.setComposeSignatureId(defaultSignatureId ?? "");

    // Compute mode-specific fields
    const fields = computeComposeInitState(
      mode,
      message,
      asNew,
      {
        accountEmail: currentAccount?.email ?? "",
        accountDateFormat,
        preferredComposeTab: options?.preferredComposeTab,
        findMessageByMessageId
      },
      { stripHtml, normalizeHtmlDerivedText }
    );

    // Apply fields to state
    compose.setComposeDraftId(fields.composeDraftId);
    compose.setComposeReplyMessage(fields.composeReplyMessage);
    compose.setComposeReplyHeaders(fields.composeReplyHeaders);
    compose.setComposeTo(fields.composeTo);
    compose.setComposeCc(fields.composeCc);
    compose.setComposeBcc(fields.composeBcc);
    compose.setComposeShowBcc(fields.composeShowBcc);
    compose.setComposeSubject(fields.composeSubject);
    compose.setComposeBody(fields.composeBody);
    compose.setComposeIncludeInvite(fields.composeIncludeInvite);
    compose.setComposeInviteLocation(fields.composeInviteLocation);
    compose.setComposeInviteStart(fields.composeInviteStart);
    compose.setComposeInviteEnd(fields.composeInviteEnd);
    compose.setComposeInviteAllDay(fields.composeInviteAllDay);
    compose.setComposeInviteRecurrenceRule(fields.composeInviteRecurrenceRule);
    compose.setComposeHtml(fields.composeHtml);
    compose.setComposeHtmlText(fields.composeHtmlText);
    compose.setComposeMarkdown(fields.composeMarkdown);
    compose.setComposeQuotedHtml(fields.composeQuotedHtml);
    compose.setComposeQuotedHtmlEdited(fields.composeQuotedHtmlEdited);
    compose.setComposeQuotedParts(fields.composeQuotedParts);
    compose.setComposeTab(fields.composeTab);
    composeLastEditedRef.current = fields.composeTab;
    compose.setComposeStripImages(fields.composeStripImages);
    compose.setComposeIncludeOriginal(fields.composeIncludeOriginal);
    compose.setComposeQuoteHtml(fields.composeQuoteHtml);
    compose.setComposeQuotedText("");

    if (fields.initialDraftHash !== null) {
      lastDraftHashRef.current = fields.initialDraftHash;
    }
    if (fields.initialDraftSavedAt !== null) {
      setDraftSavedAt(fields.initialDraftSavedAt);
    }

    compose.setComposeView("inline");
    compose.setComposeOpen(true);
  };

  const popOutCompose = () => {
    compose.setComposeView("modal");
  };

  const popInCompose = () => {
    compose.setComposeView("inline");
  };

  const minimizeCompose = () => {
    compose.setComposeView("minimized");
  };

  return {
    applySignatureToCompose,
    buildComposePayload,
    openCompose,
    popOutCompose,
    popInCompose,
    minimizeCompose
  };
}
