import { describe, expect, it } from "bun:test";
import type { ResettableComposeState } from "./resetComposeSession";
import { resetComposeSession } from "./resetComposeSession";

function createSetter<T>(store: { value: T }) {
  return (next: T | ((prev: T) => T)) => {
    store.value = typeof next === "function" ? (next as (prev: T) => T)(store.value) : next;
  };
}

describe("resetComposeSession", () => {
  it("clears compose state and transient draft tracking", () => {
    const state = {
      composeOpen: true,
      composeView: "minimized",
      composeDraftId: "draft-1",
      composeMode: "reply",
      composeTo: "alice@example.test",
      composeCc: "cc@example.test",
      composeBcc: "bcc@example.test",
      composeSubject: "Subject",
      composeBody: "Body",
      composeIncludeInvite: true,
      composeInviteLocation: "Room 1",
      composeInviteStart: "2026-03-27T09:00",
      composeInviteEnd: "2026-03-27T10:00",
      composeInviteAllDay: true,
      composeInviteRecurrenceRule: "FREQ=WEEKLY",
      composeHtml: "<p>Body</p>",
      composeHtmlText: "Body",
      composeMarkdown: "**Body**",
      composeOpenedAt: "Yesterday",
      composeSignatureId: "sig-1",
      signatureMenuOpen: true,
      composeReplyMessage: { id: "message-1" },
      composeTab: "markdown",
      composeShowBcc: true,
      composeStripImages: true,
      composeIncludeOriginal: false,
      composeQuoteHtml: false,
      composeQuotedHtml: "<blockquote>quoted</blockquote>",
      composeQuotedText: "quoted",
      composeQuotedHtmlEdited: true,
      composeReplyHeaders: { inReplyTo: "message-id" },
      composeAttachments: [{ id: "att-1" }],
      composeDragActive: true,
      composeEditorReset: 4,
      composeQuotedParts: { styles: "", headerHtml: "", bodyHtml: "" },
      composeResizing: true,
      sendingMail: true,
      draftSaving: true,
      draftSavedAt: 123,
      draftSaveError: "boom",
      discardingDraft: true
    };

    const compose: ResettableComposeState = {
      setComposeOpen: createSetter({ get value() { return state.composeOpen; }, set value(value) { state.composeOpen = value as boolean; } }),
      setComposeView: createSetter({ get value() { return state.composeView; }, set value(value) { state.composeView = value as "inline" | "modal" | "minimized"; } }),
      setComposeDraftId: createSetter({ get value() { return state.composeDraftId; }, set value(value) { state.composeDraftId = value as string | null; } }),
      setComposeMode: createSetter({ get value() { return state.composeMode; }, set value(value) { state.composeMode = value as "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew"; } }),
      setComposeTo: createSetter({ get value() { return state.composeTo; }, set value(value) { state.composeTo = value as string; } }),
      setComposeCc: createSetter({ get value() { return state.composeCc; }, set value(value) { state.composeCc = value as string; } }),
      setComposeBcc: createSetter({ get value() { return state.composeBcc; }, set value(value) { state.composeBcc = value as string; } }),
      setComposeSubject: createSetter({ get value() { return state.composeSubject; }, set value(value) { state.composeSubject = value as string; } }),
      setComposeBody: createSetter({ get value() { return state.composeBody; }, set value(value) { state.composeBody = value as string; } }),
      setComposeIncludeInvite: createSetter({ get value() { return state.composeIncludeInvite; }, set value(value) { state.composeIncludeInvite = value as boolean; } }),
      setComposeInviteLocation: createSetter({ get value() { return state.composeInviteLocation; }, set value(value) { state.composeInviteLocation = value as string; } }),
      setComposeInviteStart: createSetter({ get value() { return state.composeInviteStart; }, set value(value) { state.composeInviteStart = value as string; } }),
      setComposeInviteEnd: createSetter({ get value() { return state.composeInviteEnd; }, set value(value) { state.composeInviteEnd = value as string; } }),
      setComposeInviteAllDay: createSetter({ get value() { return state.composeInviteAllDay; }, set value(value) { state.composeInviteAllDay = value as boolean; } }),
      setComposeInviteRecurrenceRule: createSetter({ get value() { return state.composeInviteRecurrenceRule; }, set value(value) { state.composeInviteRecurrenceRule = value as string; } }),
      setComposeHtml: createSetter({ get value() { return state.composeHtml; }, set value(value) { state.composeHtml = value as string; } }),
      setComposeHtmlText: createSetter({ get value() { return state.composeHtmlText; }, set value(value) { state.composeHtmlText = value as string; } }),
      setComposeMarkdown: createSetter({ get value() { return state.composeMarkdown; }, set value(value) { state.composeMarkdown = value as string; } }),
      composeMarkdownRef: { current: "**Body**" },
      setComposeOpenedAt: createSetter({ get value() { return state.composeOpenedAt; }, set value(value) { state.composeOpenedAt = value as string; } }),
      setComposeSignatureId: createSetter({ get value() { return state.composeSignatureId; }, set value(value) { state.composeSignatureId = value as string; } }),
      setSignatureMenuOpen: createSetter({ get value() { return state.signatureMenuOpen; }, set value(value) { state.signatureMenuOpen = value as boolean; } }),
      setComposeReplyMessage: createSetter({ get value() { return state.composeReplyMessage; }, set value(value) { state.composeReplyMessage = value as { id: string } | null; } }),
      setComposeTab: createSetter({ get value() { return state.composeTab; }, set value(value) { state.composeTab = value as "text" | "html" | "markdown"; } }),
      setComposeShowBcc: createSetter({ get value() { return state.composeShowBcc; }, set value(value) { state.composeShowBcc = value as boolean; } }),
      setComposeStripImages: createSetter({ get value() { return state.composeStripImages; }, set value(value) { state.composeStripImages = value as boolean; } }),
      setComposeIncludeOriginal: createSetter({ get value() { return state.composeIncludeOriginal; }, set value(value) { state.composeIncludeOriginal = value as boolean; } }),
      setComposeQuoteHtml: createSetter({ get value() { return state.composeQuoteHtml; }, set value(value) { state.composeQuoteHtml = value as boolean; } }),
      setComposeQuotedHtml: createSetter({ get value() { return state.composeQuotedHtml; }, set value(value) { state.composeQuotedHtml = value as string; } }),
      setComposeQuotedText: createSetter({ get value() { return state.composeQuotedText; }, set value(value) { state.composeQuotedText = value as string; } }),
      setComposeQuotedHtmlEdited: createSetter({ get value() { return state.composeQuotedHtmlEdited; }, set value(value) { state.composeQuotedHtmlEdited = value as boolean; } }),
      setComposeReplyHeaders: createSetter({ get value() { return state.composeReplyHeaders; }, set value(value) { state.composeReplyHeaders = value as { inReplyTo: string } | null; } }),
      setComposeAttachments: createSetter({ get value() { return state.composeAttachments; }, set value(value) { state.composeAttachments = value as Array<{ id: string }>; } }),
      setComposeDragActive: createSetter({ get value() { return state.composeDragActive; }, set value(value) { state.composeDragActive = value as boolean; } }),
      setComposeEditorReset: createSetter({ get value() { return state.composeEditorReset; }, set value(value) { state.composeEditorReset = value as number; } }),
      setComposeQuotedParts: createSetter({ get value() { return state.composeQuotedParts; }, set value(value) { state.composeQuotedParts = value as { styles: string; headerHtml: string; bodyHtml: string } | null; } }),
      setComposeResizing: createSetter({ get value() { return state.composeResizing; }, set value(value) { state.composeResizing = value as boolean; } }),
      setSendingMail: createSetter({ get value() { return state.sendingMail; }, set value(value) { state.sendingMail = value as boolean; } }),
      setDraftSaving: createSetter({ get value() { return state.draftSaving; }, set value(value) { state.draftSaving = value as boolean; } }),
      setDraftSavedAt: createSetter({ get value() { return state.draftSavedAt; }, set value(value) { state.draftSavedAt = value as number | null; } }),
      setDraftSaveError: createSetter({ get value() { return state.draftSaveError; }, set value(value) { state.draftSaveError = value as string | null; } }),
      setDiscardingDraft: createSetter({ get value() { return state.discardingDraft; }, set value(value) { state.discardingDraft = value as boolean; } }),
      composeBodyDebounceRef: { current: setTimeout(() => undefined, 0) },
      draftSaveTimerRef: { current: setTimeout(() => undefined, 0) },
      draftSaveInFlightRef: { current: true },
      pendingDraftSaveRef: { current: { payload: { to: "", subject: "", text: "" }, hash: "hash-1" } },
      composeSessionVersionRef: { current: 4 },
      composeDraftIdRef: { current: "draft-1" },
      lastDraftHashRef: { current: "last-hash" },
      currentDraftHashRef: { current: "current-hash" },
      composeBaselineHashRef: { current: "baseline-hash" },
      composeDirtyRef: { current: true },
      composeEditorInitRef: { current: true },
      composeLastEditedRef: { current: "text" },
      composeSignatureRef: { current: { id: "sig-1", text: "Sig", html: "<p>Sig</p>" } },
      composeSelectionRef: { current: { start: 1, end: 2, value: "Body" } },
      composeDragDepthRef: { current: 2 },
      composeResizeRef: { current: { startX: 1, startY: 2, startWidth: 3, startHeight: 4 } }
    };

    resetComposeSession(compose);

    expect(state.composeOpen).toBe(false);
    expect(state.composeView).toBe("inline");
    expect(state.composeDraftId).toBeNull();
    expect(state.composeMode).toBe("new");
    expect(state.composeTo).toBe("");
    expect(state.composeCc).toBe("");
    expect(state.composeBcc).toBe("");
    expect(state.composeSubject).toBe("");
    expect(state.composeBody).toBe("");
    expect(state.composeIncludeInvite).toBe(false);
    expect(state.composeInviteLocation).toBe("");
    expect(state.composeInviteStart).toBe("");
    expect(state.composeInviteEnd).toBe("");
    expect(state.composeInviteAllDay).toBe(false);
    expect(state.composeInviteRecurrenceRule).toBe("");
    expect(state.composeHtml).toBe("");
    expect(state.composeHtmlText).toBe("");
    expect(state.composeMarkdown).toBe("");
    expect(state.composeOpenedAt).toBe("");
    expect(state.composeSignatureId).toBe("");
    expect(state.signatureMenuOpen).toBe(false);
    expect(state.composeReplyMessage).toBeNull();
    expect(state.composeTab).toBe("html");
    expect(state.composeShowBcc).toBe(false);
    expect(state.composeStripImages).toBe(false);
    expect(state.composeIncludeOriginal).toBe(true);
    expect(state.composeQuoteHtml).toBe(true);
    expect(state.composeQuotedHtml).toBe("");
    expect(state.composeQuotedText).toBe("");
    expect(state.composeQuotedHtmlEdited).toBe(false);
    expect(state.composeReplyHeaders).toBeNull();
    expect(state.composeAttachments).toEqual([]);
    expect(state.composeDragActive).toBe(false);
    expect(state.composeEditorReset).toBe(5);
    expect(state.composeQuotedParts).toBeNull();
    expect(state.composeResizing).toBe(false);
    expect(state.sendingMail).toBe(false);
    expect(state.draftSaving).toBe(false);
    expect(state.draftSavedAt).toBeNull();
    expect(state.draftSaveError).toBeNull();
    expect(state.discardingDraft).toBe(false);

    expect(compose.composeBodyDebounceRef.current).toBeNull();
    expect(compose.draftSaveTimerRef.current).toBeNull();
    expect(compose.draftSaveInFlightRef.current).toBe(false);
    expect(compose.pendingDraftSaveRef.current).toBeNull();
    expect(compose.composeSessionVersionRef.current).toBe(5);
    expect(compose.composeDraftIdRef.current).toBeNull();
    expect(compose.lastDraftHashRef.current).toBe("");
    expect(compose.currentDraftHashRef.current).toBe("");
    expect(compose.composeBaselineHashRef.current).toBeNull();
    expect(compose.composeDirtyRef.current).toBe(false);
    expect(compose.composeEditorInitRef.current).toBe(false);
    expect(compose.composeLastEditedRef.current).toBe("html");
    expect(compose.composeSignatureRef.current).toBeNull();
    expect(compose.composeSelectionRef.current).toBeNull();
    expect(compose.composeDragDepthRef.current).toBe(0);
    expect(compose.composeResizeRef.current).toBeNull();
    expect(compose.composeMarkdownRef.current).toBe("");
  });
});
