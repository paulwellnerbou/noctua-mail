import type React from "react";
import { X } from "lucide-react";
import { MinusIcon, RowsIcon } from "@radix-ui/react-icons";
import ComposeFields from "./ComposeFields";
import { Button, Heading, IconButton, Text } from "@radix-ui/themes";
import styles from "./Compose.module.css";

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
    activeAccountId: string | null;
    composeDraftId: string | null;
    composeOpen: boolean;
    composeFieldsReset: number;
    draftSaving: boolean;
    draftSaveError: string | null;
    draftSavedAt: number | null;
    sendingMail: boolean;
    discardingDraft: boolean;
    composeDragActive: boolean;
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
    applyRecipientSelection: (
      current: string,
      selection: string,
      setter: React.Dispatch<React.SetStateAction<string>>,
      focusAfter?: "to" | "cc" | "bcc" | null
    ) => string;
    loadRecipientOptions: (query: string, signal: AbortSignal) => Promise<string[]>;
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
    activeAccountId,
    composeDraftId,
    composeOpen,
    composeFieldsReset,
    draftSaving,
    draftSaveError,
    draftSavedAt,
    sendingMail,
    discardingDraft,
    composeDragActive,
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
    applyRecipientSelection,
    loadRecipientOptions,
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
        className={`${styles.composeModal} ${discardingDraft ? styles.disabled : ""} ${
          composeDragActive ? styles.composeDropActive : ""
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
        <div className={styles.composeHeader}>
          <div>
            <Heading size="5" weight="bold" className={styles.composeTitle}>
              {composeTitle}
            </Heading>
            <Text size="2" color="gray" className={styles.composeSubtitle}>
              From {fromValue}
            </Text>
          </div>
          <div className={styles.composeHeaderActions}>
            <IconButton
              variant="ghost"
              size="2"
              title="Dock in thread view"
              aria-label="Dock in thread view"
              onClick={popInCompose}
            >
              <RowsIcon width={16} height={16} />
            </IconButton>
            <IconButton
              variant="ghost"
              size="2"
              title="Minimize composer"
              aria-label="Minimize composer"
              onClick={minimizeCompose}
            >
              <MinusIcon width={16} height={16} />
            </IconButton>
            <IconButton
              variant="ghost"
              size="2"
              title="Close composer"
              aria-label="Close composer"
              onClick={() => {
                setComposeOpen(false);
                setComposeView("inline");
              }}
            >
              <X size={16} />
            </IconButton>
          </div>
        </div>
        <div className={styles.composeBody}>
          <ComposeFields
            key={`modal-fields-${composeFieldsReset}`}
            variant="modal"
            composeSubject={composeSubject}
            composeTo={composeTo}
            composeCc={composeCc}
            composeBcc={composeBcc}
            composeShowBcc={composeShowBcc}
            composeOpenedAt={composeOpenedAt}
            activeAccountId={activeAccountId}
            setComposeSubject={setComposeSubject}
            setComposeTo={setComposeTo}
            setComposeCc={setComposeCc}
            setComposeBcc={setComposeBcc}
            setComposeShowBcc={setComposeShowBcc}
            applyRecipientSelection={applyRecipientSelection}
            loadRecipientOptions={loadRecipientOptions}
            getComposeToken={getComposeToken}
            markComposeDirty={markComposeDirty}
          />
          {ui.composeMessageField}
        </div>
        <div className={styles.composeFooter}>
          <div className={styles.composeDraftMeta}>
            {composeDraftId && (
              <Text size="1" color="gray" className={styles.composeDraft}>
                Draft: {composeDraftId}
              </Text>
            )}
            {composeOpen && (
              <Text
                size="1"
                className={`${styles.composeDraftStatus} ${
                  draftSaveError
                    ? styles.composeDraftStatusError
                    : draftSaving
                      ? styles.composeDraftStatusSaving
                      : ""
                }`}
              >
                {draftSaving
                  ? "Saving draft…"
                  : draftSaveError
                    ? "Draft save failed"
                    : draftSavedAt
                      ? `Draft saved ${formatRelativeTime(draftSavedAt)}`
                      : "Draft not saved yet"}
              </Text>
            )}
          </div>
          <div className={styles.composeActions}>
            {composeDraftId && (
              <Button
                size="2"
                variant="soft"
                color="red"
                onClick={handleDiscardDraft}
                disabled={discardingDraft || draftSaving}
              >
                Discard Draft
              </Button>
            )}
            <Button
              size="2"
              variant="soft"
              color="gray"
              onClick={() => {
                setComposeOpen(false);
                setComposeView("inline");
              }}
            >
              Cancel
            </Button>
            <Button size="2" onClick={handleSendMail} disabled={sendingMail}>
              {sendingMail ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
        <div
          className={styles.composeResizer}
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
