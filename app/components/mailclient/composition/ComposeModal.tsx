import type React from "react";
import { ArrowDownLeft, Minimize2, X } from "lucide-react";

type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew";

type ComposeModalProps = {
  open: boolean;
  state: {
    composeMode: ComposeMode;
    composeTo: string;
    composeCc: string;
    composeBcc: string;
    composeSubject: string;
    composeShowBcc: boolean;
    composeOpenedAt: string;
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
    composeSize: { width: number; height: number | null };
  };
  ui: {
    composeMessageField: React.ReactNode;
  };
  refs: {
    composeModalRef: React.RefObject<HTMLDivElement | null>;
    composeResizeRef: React.MutableRefObject<{
      startX: number;
      startY: number;
      startWidth: number;
      startHeight: number;
    } | null>;
  };
  actions: {
    setComposeTo: React.Dispatch<React.SetStateAction<string>>;
    setComposeCc: React.Dispatch<React.SetStateAction<string>>;
    setComposeBcc: React.Dispatch<React.SetStateAction<string>>;
    setComposeSubject: React.Dispatch<React.SetStateAction<string>>;
    setComposeShowBcc: React.Dispatch<React.SetStateAction<boolean>>;
    setComposeOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setComposeView: React.Dispatch<React.SetStateAction<"inline" | "modal" | "minimized">>;
    setComposeResizing: React.Dispatch<React.SetStateAction<boolean>>;
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
    popInCompose: () => void;
    minimizeCompose: () => void;
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

export default function ComposeModal({
  open,
  state,
  ui,
  refs,
  actions,
  helpers,
  dragHandlers
}: ComposeModalProps) {
  if (!open) return null;

  const {
    composeMode,
    composeTo,
    composeCc,
    composeBcc,
    composeSubject,
    composeShowBcc,
    composeOpenedAt,
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
    fromValue,
    composeSize
  } = state;
  const { composeModalRef, composeResizeRef } = refs;
  const {
    setComposeTo,
    setComposeCc,
    setComposeBcc,
    setComposeSubject,
    setComposeShowBcc,
    setComposeOpen,
    setComposeView,
    setComposeResizing,
    handleSendMail,
    handleDiscardDraft,
    setRecipientQuery,
    setRecipientFocus,
    setRecipientActiveIndex,
    applyRecipientSelection,
    markComposeDirty,
    popInCompose,
    minimizeCompose
  } = actions;
  const { getComposeToken, formatRelativeTime } = helpers;
  const { handleComposeDragEnter, handleComposeDragLeave, handleComposeDragOver, handleComposeDrop } =
    dragHandlers;

  const composeTitle =
    composeMode === "edit"
      ? "Edit draft"
      : composeMode === "editAsNew"
        ? "Edit as New"
        : composeMode === "reply"
          ? "Reply"
          : composeMode === "replyAll"
            ? "Reply All"
            : composeMode === "forward"
              ? "Forward"
              : "New message";

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          setComposeOpen(false);
          setComposeView("inline");
        }
      }}
    >
      <div
        className={`compose-modal ${discardingDraft ? "disabled" : ""}${
          composeDragActive ? " compose-drop-active" : ""
        }`}
        ref={composeModalRef}
        style={{
          width: composeSize.width,
          height: composeSize.height ?? "85vh"
        }}
        onClick={(event) => event.stopPropagation()}
        onDragEnter={handleComposeDragEnter}
        onDragLeave={handleComposeDragLeave}
        onDragOver={handleComposeDragOver}
        onDrop={handleComposeDrop}
      >
        <div className="compose-header">
          <div>
            <h3>{composeTitle}</h3>
            <p className="compose-subtitle">From {fromValue}</p>
          </div>
          <div className="compose-header-actions">
            <button
              className="icon-button"
              title="Dock in thread view"
              aria-label="Dock in thread view"
              onClick={popInCompose}
            >
              <ArrowDownLeft size={14} />
            </button>
            <button
              className="icon-button"
              title="Minimize composer"
              aria-label="Minimize composer"
              onClick={minimizeCompose}
            >
              <Minimize2 size={14} />
            </button>
            <button
              className="icon-button"
              title="Close composer"
              aria-label="Close composer"
              onClick={() => {
                setComposeOpen(false);
                setComposeView("inline");
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="compose-body">
          <div className="compose-grid">
            <div className="compose-grid-row">
              <span className="label">To:</span>
              <div className="compose-row">
                <div className="compose-input-wrap">
                  <input
                    value={composeTo}
                    onChange={(event) => {
                      markComposeDirty();
                      setComposeTo(event.target.value);
                      setRecipientQuery(getComposeToken(event.target.value));
                    }}
                    onFocus={() => {
                      setRecipientFocus("to");
                      setRecipientQuery(getComposeToken(composeTo));
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        setRecipientFocus((current) => (current === "to" ? null : current));
                      }, 150);
                    }}
                    onKeyDown={(event) => {
                      if (!recipientOptions.length) return;
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setRecipientActiveIndex((prev) =>
                          Math.min(prev + 1, recipientOptions.length - 1)
                        );
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setRecipientActiveIndex((prev) => Math.max(prev - 1, 0));
                      }
                      if (event.key === "Enter" && recipientFocus === "to") {
                        event.preventDefault();
                        const pick = recipientOptions[recipientActiveIndex];
                        if (pick) {
                          applyRecipientSelection(composeTo, pick, setComposeTo);
                        }
                      }
                    }}
                    placeholder="recipient@example.com"
                  />
                  {recipientFocus === "to" && recipientOptions.length > 0 && (
                    <div className="compose-suggestions">
                      {recipientOptions.map((option, index) => (
                        <button
                          key={`${option}-${index}`}
                          type="button"
                          className={`compose-suggestion ${
                            index === recipientActiveIndex ? "active" : ""
                          }`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applyRecipientSelection(composeTo, option, setComposeTo);
                          }}
                        >
                          {option}
                        </button>
                      ))}
                      {recipientLoading && (
                        <span className="compose-suggestion muted">Loading…</span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="icon-button small"
                  title={composeShowBcc ? "Hide Cc and Bcc" : "Show Cc and Bcc"}
                  onClick={() => setComposeShowBcc((value) => !value)}
                >
                  {composeShowBcc ? "Hide Cc/Bcc" : "Show Cc and Bcc"}
                </button>
              </div>
            </div>
            {composeShowBcc && (
              <div className="compose-grid-row">
                <span className="label">Cc:</span>
                <div className="compose-input-wrap">
                  <input
                    value={composeCc}
                    onChange={(event) => {
                      markComposeDirty();
                      setComposeCc(event.target.value);
                      setRecipientQuery(getComposeToken(event.target.value));
                    }}
                    onFocus={() => {
                      setRecipientFocus("cc");
                      setRecipientQuery(getComposeToken(composeCc));
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        setRecipientFocus((current) => (current === "cc" ? null : current));
                      }, 150);
                    }}
                    onKeyDown={(event) => {
                      if (!recipientOptions.length) return;
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setRecipientActiveIndex((prev) =>
                          Math.min(prev + 1, recipientOptions.length - 1)
                        );
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setRecipientActiveIndex((prev) => Math.max(prev - 1, 0));
                      }
                      if (event.key === "Enter" && recipientFocus === "cc") {
                        event.preventDefault();
                        const pick = recipientOptions[recipientActiveIndex];
                        if (pick) {
                          applyRecipientSelection(composeCc, pick, setComposeCc);
                        }
                      }
                    }}
                    placeholder="cc@example.com"
                  />
                  {recipientFocus === "cc" && recipientOptions.length > 0 && (
                    <div className="compose-suggestions">
                      {recipientOptions.map((option, index) => (
                        <button
                          key={`${option}-${index}`}
                          type="button"
                          className={`compose-suggestion ${
                            index === recipientActiveIndex ? "active" : ""
                          }`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applyRecipientSelection(composeCc, option, setComposeCc);
                          }}
                        >
                          {option}
                        </button>
                      ))}
                      {recipientLoading && (
                        <span className="compose-suggestion muted">Loading…</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            {composeShowBcc && (
              <div className="compose-grid-row">
                <span className="label">Bcc:</span>
                <div className="compose-input-wrap">
                  <input
                    value={composeBcc}
                    onChange={(event) => {
                      markComposeDirty();
                      setComposeBcc(event.target.value);
                      setRecipientQuery(getComposeToken(event.target.value));
                    }}
                    onFocus={() => {
                      setRecipientFocus("bcc");
                      setRecipientQuery(getComposeToken(composeBcc));
                    }}
                    onBlur={() => {
                      setTimeout(() => {
                        setRecipientFocus((current) => (current === "bcc" ? null : current));
                      }, 150);
                    }}
                    onKeyDown={(event) => {
                      if (!recipientOptions.length) return;
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setRecipientActiveIndex((prev) =>
                          Math.min(prev + 1, recipientOptions.length - 1)
                        );
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setRecipientActiveIndex((prev) => Math.max(prev - 1, 0));
                      }
                      if (event.key === "Enter" && recipientFocus === "bcc") {
                        event.preventDefault();
                        const pick = recipientOptions[recipientActiveIndex];
                        if (pick) {
                          applyRecipientSelection(composeBcc, pick, setComposeBcc);
                        }
                      }
                    }}
                    placeholder="bcc@example.com"
                  />
                  {recipientFocus === "bcc" && recipientOptions.length > 0 && (
                    <div className="compose-suggestions">
                      {recipientOptions.map((option, index) => (
                        <button
                          key={`${option}-${index}`}
                          type="button"
                          className={`compose-suggestion ${
                            index === recipientActiveIndex ? "active" : ""
                          }`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applyRecipientSelection(composeBcc, option, setComposeBcc);
                          }}
                        >
                          {option}
                        </button>
                      ))}
                      {recipientLoading && (
                        <span className="compose-suggestion muted">Loading…</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="compose-grid-row">
              <span className="label">Subject:</span>
              <input
                value={composeSubject}
                onChange={(event) => {
                  markComposeDirty();
                  setComposeSubject(event.target.value);
                }}
                placeholder="Subject"
              />
            </div>
            <div className="compose-grid-row">
              <span className="label">Date:</span>
              <span className="compose-static">{composeOpenedAt || "Now"}</span>
            </div>
          </div>
          {ui.composeMessageField}
        </div>
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
              Cancel
            </button>
            <button className="icon-button active" onClick={handleSendMail} disabled={sendingMail}>
              {sendingMail ? "Sending..." : "Send"}
            </button>
          </div>
        </div>
        <div
          className="compose-resizer"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // ignore if capture fails
            }
            const rect = composeModalRef.current?.getBoundingClientRect();
            const startWidth = rect?.width ?? composeSize.width;
            const startHeight = rect?.height ?? (composeSize.height ?? window.innerHeight * 0.85);
            composeResizeRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              startWidth,
              startHeight
            };
            setComposeResizing(true);
          }}
        />
      </div>
    </div>
  );
}
