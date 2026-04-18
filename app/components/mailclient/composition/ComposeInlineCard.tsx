import { ArrowUpRight } from "lucide-react";
import { Badge, Card, IconButton } from "@radix-ui/themes";
import { badgeColors } from "@/lib/ui/badgeColors";
import ComposeFields from "./ComposeFields";
import ComposeActions from "./ComposeActions";
import { useComposeContext } from "./ComposeContext";
import threadStyles from "../message/ThreadMessageCard.module.css";
import styles from "./ComposeInlineCard.module.css";
import composeStyles from "./Compose.module.css";

export default function ComposeInlineCard() {
  const {
    composeMode,
    composeSubject,
    composeTo,
    composeCc,
    composeBcc,
    composeShowBcc,
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
    fromValue,
    inReplyToMessage,
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
    handleSaveDraft,
    applyRecipientSelection,
    loadRecipientOptions,
    markComposeDirty,
    jumpToMessage,
    getComposeToken,
    formatRelativeTime,
    handleComposeDragEnter,
    handleComposeDragLeave,
    handleComposeDragOver,
    handleComposeDrop,
    composeMessageField
  } = useComposeContext();

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
    <Card
      asChild
      size="2"
      variant="surface"
      className={`${threadStyles.card} ${styles.card} ${
        discardingDraft ? styles.disabled : ""
      } ${composeDragActive ? composeStyles.composeDropActive : ""}`}
    >
      <article
        className={styles.article}
        onDragEnter={handleComposeDragEnter}
        onDragLeave={handleComposeDragLeave}
        onDragOver={handleComposeDragOver}
        onDrop={handleComposeDrop}
      >
        <div className={threadStyles.header}>
          <div className={threadStyles.topRow}>
            <div className={threadStyles.badges}>
              <Badge size="1" variant="soft" color={badgeColors.compose}>
                {composeModeLabel}
              </Badge>
            </div>
            <div className={threadStyles.actions}>
              <IconButton
                variant="ghost"
                size="2"
                title="Open in modal"
                aria-label="Open in modal"
                onClick={popOutCompose}
              >
                <ArrowUpRight size={14} />
              </IconButton>
            </div>
          </div>
          <div className={`${threadStyles.info} ${styles.info}`}>
            <ComposeFields
              key={`inline-fields-${composeFieldsReset}`}
              variant="inline"
              composeSubject={composeSubject}
              composeTo={composeTo}
              composeCc={composeCc}
              composeBcc={composeBcc}
              composeShowBcc={composeShowBcc}
              activeAccountId={activeAccountId}
              fromValue={fromValue}
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
          </div>
        </div>
        <div className={`${composeStyles.composeBody} ${styles.body}`}>{composeMessageField}</div>
        <ComposeActions
          composeDraftId={composeDraftId}
          composeOpen={composeOpen}
          canSaveDraft={canSaveDraft}
          draftSaving={draftSaving}
          draftSaveError={draftSaveError}
          draftSavedAt={draftSavedAt}
          sendingMail={sendingMail}
          discardingDraft={discardingDraft}
          handleDiscardDraft={handleDiscardDraft}
          handleSaveDraft={handleSaveDraft}
          handleCancel={() => {
            setComposeOpen(false);
            setComposeView("inline");
          }}
          handleSendMail={handleSendMail}
          formatRelativeTime={formatRelativeTime}
        />
      </article>
    </Card>
  );
}
