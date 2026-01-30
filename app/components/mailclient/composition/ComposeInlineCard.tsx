import type React from "react";
import { ArrowUpRight } from "lucide-react";
import ComposeFields from "./ComposeFields";

type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew";

type ComposeInlineCardProps = {
  state: {
    composeMode: ComposeMode;
    composeSubject: string;
    composeTo: string;
    composeCc: string;
    composeBcc: string;
    composeShowBcc: boolean;
    composeDraftId: string | null;
    composeOpen: boolean;
    draftSaving: boolean;
    draftSaveError: string | null;
    draftSavedAt: number | null;
    sendingMail: boolean;
    discardingDraft: boolean;
    composeDragActive: boolean;
    recipientOptions: string[];
    recipientActiveIndex: number;
    recipientLoading: boolean;
    recipientFocus: "to" | "cc" | "bcc" | null;
    fromValue: string;
  };
  ui: {
    composeMessageField: React.ReactNode;
  };
  actions: {
    popOutCompose: () => void;
    setComposeSubject: React.Dispatch<React.SetStateAction<string>>;
    setComposeTo: React.Dispatch<React.SetStateAction<string>>;
    setComposeCc: React.Dispatch<React.SetStateAction<string>>;
    setComposeBcc: React.Dispatch<React.SetStateAction<string>>;
    setComposeShowBcc: React.Dispatch<React.SetStateAction<boolean>>;
    setComposeOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setComposeView: React.Dispatch<React.SetStateAction<"inline" | "modal" | "minimized">>;
    handleSendMail: () => void;
    handleDiscardDraft: () => void;
    setRecipientQuery: React.Dispatch<React.SetStateAction<string>>;
    setRecipientFocus: React.Dispatch<React.SetStateAction<"to" | "cc" | "bcc" | null>>;
    setRecipientActiveIndex: React.Dispatch<React.SetStateAction<number>>;
    applyRecipientSelection: (
      current: string,
      selection: string,
      setter: React.Dispatch<React.SetStateAction<string>>
    ) => void;
    markComposeDirty: () => void;
  };
  helpers: {
    getComposeToken: (value: string) => string;
    formatRelativeTime: (timestamp: number | null) => string;
  };
  dragHandlers: {
    handleComposeDragEnter: (event: React.DragEvent) => void;
    handleComposeDragLeave: (event: React.DragEvent) => void;
    handleComposeDragOver: (event: React.DragEvent) => void;
    handleComposeDrop: (event: React.DragEvent) => void;
  };
};

export default function ComposeInlineCard({
  state,
  ui,
  actions,
  helpers,
  dragHandlers
}: ComposeInlineCardProps) {
  const {
    composeMode,
    composeSubject,
    composeTo,
    composeCc,
    composeBcc,
    composeShowBcc,
    composeDraftId,
    composeOpen,
    draftSaving,
    draftSaveError,
    draftSavedAt,
    sendingMail,
    discardingDraft,
    composeDragActive,
    recipientOptions,
    recipientActiveIndex,
    recipientLoading,
    recipientFocus,
    fromValue
  } = state;
  const {
    popOutCompose,
    setComposeSubject,
    setComposeTo,
    setComposeCc,
    setComposeBcc,
    setComposeShowBcc,
    setComposeOpen,
    setComposeView,
    handleSendMail,
    handleDiscardDraft,
    setRecipientQuery,
    setRecipientFocus,
    setRecipientActiveIndex,
    applyRecipientSelection,
    markComposeDirty
  } = actions;
  const { getComposeToken, formatRelativeTime } = helpers;
  const { handleComposeDragEnter, handleComposeDragLeave, handleComposeDragOver, handleComposeDrop } =
    dragHandlers;

  const composeModeLabel =
    composeMode === "reply"
      ? "Reply"
      : composeMode === "replyAll"
        ? "Reply all"
        : composeMode === "forward"
          ? "Forward"
          : composeMode === "edit"
            ? "Edit draft"
            : composeMode === "editAsNew"
              ? "Edit as New"
              : "New message";

  return (
    <article
      className={`thread-card compose-card compose-inline ${
        discardingDraft ? "disabled" : ""
      }${composeDragActive ? " compose-drop-active" : ""}`}
      onDragEnter={handleComposeDragEnter}
      onDragLeave={handleComposeDragLeave}
      onDragOver={handleComposeDragOver}
      onDrop={handleComposeDrop}
    >
      <div className="thread-card-header">
        <div className="thread-card-top">
          <div className="thread-card-badges">
            <span className="thread-badge compose">{composeModeLabel}</span>
          </div>
          <div className="thread-card-actions">
            <button
              className="icon-button ghost"
              title="Open in modal"
              aria-label="Open in modal"
              onClick={popOutCompose}
            >
              <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
        <div className="thread-card-info">
          <ComposeFields
            variant="inline"
            composeSubject={composeSubject}
            composeTo={composeTo}
            composeCc={composeCc}
            composeBcc={composeBcc}
            composeShowBcc={composeShowBcc}
            fromValue={fromValue}
            recipientOptions={recipientOptions}
            recipientActiveIndex={recipientActiveIndex}
            recipientLoading={recipientLoading}
            recipientFocus={recipientFocus}
            setComposeSubject={setComposeSubject}
            setComposeTo={setComposeTo}
            setComposeCc={setComposeCc}
            setComposeBcc={setComposeBcc}
            setComposeShowBcc={setComposeShowBcc}
            setRecipientQuery={setRecipientQuery}
            setRecipientFocus={setRecipientFocus}
            setRecipientActiveIndex={setRecipientActiveIndex}
            applyRecipientSelection={applyRecipientSelection}
            getComposeToken={getComposeToken}
            markComposeDirty={markComposeDirty}
          />
        </div>
      </div>
      <div className="compose-body">{ui.composeMessageField}</div>
      <div className="compose-footer">
        <div className="compose-draft-meta">
          {composeDraftId && <span className="compose-draft">Draft: {composeDraftId}</span>}
          {composeOpen && (
            <span
              className={`compose-draft-status ${
                draftSaveError ? "error" : draftSaving ? "saving" : ""
              }`}
            >
              {draftSaving
                ? "Saving draft…"
                : draftSaveError
                  ? "Draft save failed"
                  : draftSavedAt
                    ? `Draft saved ${formatRelativeTime(draftSavedAt)}`
                    : "Draft not saved yet"}
            </span>
          )}
        </div>
        <div className="compose-actions">
          {composeDraftId && (
            <button
              className="icon-button"
              onClick={handleDiscardDraft}
              disabled={discardingDraft}
            >
              Discard Draft
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => {
              setComposeOpen(false);
              setComposeView("inline");
            }}
          >
            {composeMode === "edit" ? "Cancel editing" : "Cancel"}
          </button>
          <button className="icon-button active" onClick={handleSendMail} disabled={sendingMail}>
            {sendingMail ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </article>
  );
}
