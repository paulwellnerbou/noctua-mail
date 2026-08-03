import { useCallback, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Attachment, Message, RecipientSuggestion } from "@/lib/data";
import type {
  ComposeMode,
  ComposeQuotedParts,
  ComposeReplyHeaders,
  ComposeResizeState,
  ComposeSelectionState,
  ComposeSignatureState,
  ComposeSize,
  ComposeTab,
  ComposeView,
  DraftSavePayload,
  PendingImageDrop
} from "./composeTypes";

export function useComposeState() {
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeView, setComposeView] = useState<ComposeView>("inline");
  const [composeDraftId, setComposeDraftId] = useState<string | null>(null);
  const [composeMode, setComposeMode] = useState<ComposeMode>("new");
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeBcc, setComposeBcc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const composeBodyDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const composeBodyLastUpdateRef = useRef<number>(0);
  const [composeIncludeInvite, setComposeIncludeInvite] = useState(false);
  const [composeInviteLocation, setComposeInviteLocation] = useState("");
  const [composeInviteStart, setComposeInviteStart] = useState("");
  const [composeInviteEnd, setComposeInviteEnd] = useState("");
  const [composeInviteAllDay, setComposeInviteAllDay] = useState(false);
  const [composeInviteRecurrenceRule, setComposeInviteRecurrenceRule] = useState("");
  const [composeHtml, setComposeHtml] = useState("");
  const [composeHtmlText, setComposeHtmlText] = useState("");
  const [composeMarkdownState, setComposeMarkdownState] = useState("");
  const composeMarkdownRef = useRef("");
  const setComposeMarkdown = useCallback<Dispatch<SetStateAction<string>>>((next) => {
    setComposeMarkdownState((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      composeMarkdownRef.current = value;
      return value;
    });
  }, []);
  const composeMarkdown = composeMarkdownState;
  const [composeOpenedAt, setComposeOpenedAt] = useState("");
  const [composeSignatureId, setComposeSignatureId] = useState<string>("");
  const [signatureMenuOpen, setSignatureMenuOpen] = useState(false);
  const composeSignatureRef = useRef<ComposeSignatureState | null>(null);
  const [composeReplyMessage, setComposeReplyMessage] = useState<Message | null>(null);
  const [composeTab, setComposeTab] = useState<ComposeTab>("html");
  const [composeShowBcc, setComposeShowBcc] = useState(false);
  const [composeStripImages, setComposeStripImages] = useState(false);
  const [composeIncludeOriginal, setComposeIncludeOriginal] = useState(true);
  const [composeQuoteHtml, setComposeQuoteHtml] = useState(true);
  const [composeQuotedHtml, setComposeQuotedHtml] = useState("");
  const [composeQuotedText, setComposeQuotedText] = useState("");
  const [composeQuotedHtmlEdited, setComposeQuotedHtmlEdited] = useState(false);
  const [composeReplyHeaders, setComposeReplyHeaders] = useState<ComposeReplyHeaders | null>(null);
  const [composeAttachments, setComposeAttachments] = useState<Attachment[]>([]);
  const [composeDragActive, setComposeDragActive] = useState(false);
  const [pendingImageDrop, setPendingImageDrop] = useState<PendingImageDrop | null>(null);
  const [composeEditorReset, setComposeEditorReset] = useState(0);
  const [composeQuotedParts, setComposeQuotedParts] = useState<ComposeQuotedParts | null>(null);
  const recipientCacheRef = useRef<Record<string, RecipientSuggestion[]>>({});
  const [composeSize, setComposeSize] = useState<ComposeSize>({
    width: 980,
    height: null
  });
  const [composeResizing, setComposeResizing] = useState(false);
  const composeResizeRef = useRef<ComposeResizeState | null>(null);
  const composeModalRef = useRef<HTMLDivElement | null>(null);
  const composeTextRef = useRef<HTMLTextAreaElement | null>(null);
  const composeSelectionRef = useRef<ComposeSelectionState | null>(null);
  const composeDragDepthRef = useRef(0);
  const composeCardRef = useRef<HTMLDivElement | null>(null);
  const [sendingMail, setSendingMail] = useState(false);
  // Mirrors `sendingMail` synchronously so the send handler can claim the send
  // before React re-renders the disabled button.
  const sendingMailRef = useRef(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [discardingDraft, setDiscardingDraft] = useState(false);
  const draftSaveTimerRef = useRef<number | null>(null);
  const draftSaveInFlightRef = useRef(false);
  const pendingDraftSaveRef = useRef<{ payload: DraftSavePayload; hash: string } | null>(null);
  const composeSessionVersionRef = useRef(0);
  const composeDraftIdRef = useRef<string | null>(null);
  const lastDraftHashRef = useRef<string>("");
  const currentDraftHashRef = useRef<string>("");
  const composeBaselineHashRef = useRef<string | null>(null);
  const composeDirtyRef = useRef(false);
  const composeEditorInitRef = useRef(false);
  const composeLastEditedRef = useRef<ComposeTab>("html");

  return {
    composeOpen,
    setComposeOpen,
    composeView,
    setComposeView,
    composeDraftId,
    setComposeDraftId,
    composeMode,
    setComposeMode,
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
    setComposeOpenedAt,
    composeSignatureId,
    setComposeSignatureId,
    signatureMenuOpen,
    setSignatureMenuOpen,
    composeSignatureRef,
    composeReplyMessage,
    setComposeReplyMessage,
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
    composeQuotedHtmlEdited,
    setComposeQuotedHtmlEdited,
    composeReplyHeaders,
    setComposeReplyHeaders,
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
    recipientCacheRef,
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
  };
}

export type ComposeState = ReturnType<typeof useComposeState>;
