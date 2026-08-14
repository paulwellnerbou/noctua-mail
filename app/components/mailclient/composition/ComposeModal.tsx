import { Dock, ExternalLink, X } from "lucide-react";
import { MinusIcon } from "@radix-ui/react-icons";
import ComposeFields from "./ComposeFields";
import ComposeActions from "./ComposeActions";
import { Heading, IconButton, Text } from "@radix-ui/themes";
import { useComposeContext } from "./ComposeContext";
import styles from "./Compose.module.css";

type ComposeModalProps = {
  open: boolean;
};

export default function ComposeModal({ open }: ComposeModalProps) {
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
    canSaveDraft,
    draftSaving,
    draftSaveError,
    draftSavedAt,
    sendingMail,
    discardingDraft,
    composeDragActive,
    detachedWindow,
    fromValue,
    composeSize,
    inReplyToMessage,
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
    handleSendMail,
    handleDiscardDraft,
    handleSaveDraft,
    applyRecipientSelection,
    loadRecipientOptions,
    markComposeDirty,
    popInCompose,
    minimizeCompose,
    openComposeInNewWindow,
    closeDetachedCompose,
    detachingCompose,
    jumpToMessage,
    getComposeToken,
    formatRelativeTime,
    handleComposeDragEnter,
    handleComposeDragLeave,
    handleComposeDragOver,
    handleComposeDrop,
    composeMessageField
  } = useComposeContext();

  if (!open) return null;

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
          if (detachedWindow) {
            setComposeView("inline");
            return;
          }
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
              disabled={detachingCompose || sendingMail || discardingDraft}
            >
              <Dock size={16} />
            </IconButton>
            {!detachedWindow && (
              <>
                <IconButton
                  variant="ghost"
                  size="2"
                  title="Open in new window"
                  aria-label="Open composer in new window"
                  onClick={openComposeInNewWindow}
                  disabled={detachingCompose || sendingMail || discardingDraft}
                >
                  <ExternalLink size={16} />
                </IconButton>
                <IconButton
                  variant="ghost"
                  size="2"
                  title="Minimize composer"
                  aria-label="Minimize composer"
                  onClick={minimizeCompose}
                  disabled={detachingCompose}
                >
                  <MinusIcon width={16} height={16} />
                </IconButton>
              </>
            )}
            <IconButton
              variant="ghost"
              size="2"
              title="Close composer"
              aria-label="Close composer"
              disabled={detachingCompose}
              onClick={() => {
                if (detachedWindow) {
                  setComposeView("inline");
                  return;
                }
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
            inReplyToMessage={inReplyToMessage}
            onJumpToMessage={jumpToMessage}
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
          {composeMessageField}
        </div>
        <ComposeActions
          composeDraftId={composeDraftId}
          composeOpen={composeOpen}
          canSaveDraft={canSaveDraft}
          draftSaving={draftSaving}
          draftSaveError={draftSaveError}
          draftSavedAt={draftSavedAt}
          sendingMail={sendingMail}
          discardingDraft={discardingDraft}
          busy={detachingCompose}
          handleDiscardDraft={handleDiscardDraft}
          handleSaveDraft={handleSaveDraft}
          handleCancel={() => {
            if (detachedWindow) {
              closeDetachedCompose();
              return;
            }
            setComposeOpen(false);
            setComposeView("inline");
          }}
          handleSendMail={handleSendMail}
          formatRelativeTime={formatRelativeTime}
        />
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
