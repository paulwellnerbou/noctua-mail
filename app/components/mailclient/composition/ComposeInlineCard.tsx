import type React from "react";
import { ArrowUpRight } from "lucide-react";
import { Badge, Card, IconButton } from "@radix-ui/themes";
import { badgeColors } from "@/lib/ui/badgeColors";
import type { Message, RecipientSuggestion } from "@/lib/data";
import ComposeFields from "./ComposeFields";
import ComposeActions from "./ComposeActions";
import threadStyles from "../message/ThreadMessageCard.module.css";
import styles from "./ComposeInlineCard.module.css";
import composeStyles from "./Compose.module.css";

type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "edit" | "editAsNew";

type ComposeInlineCardProps = {
  state: {
    composeMode: ComposeMode;
    composeSubject: string;
    composeTo: string;
    composeCc: string;
    composeBcc: string;
    composeShowBcc: boolean;
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
    inReplyToMessage: Message | null;
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
    handleSaveDraft: () => void;
    applyRecipientSelection: (
      current: string,
      selection: RecipientSuggestion,
      setter: React.Dispatch<React.SetStateAction<string>>,
      focusAfter?: "to" | "cc" | "bcc" | null
    ) => string;
    loadRecipientOptions: (query: string, signal: AbortSignal) => Promise<RecipientSuggestion[]>;
    markComposeDirty: () => void;
    jumpToMessage: (messageId: string) => void;
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
    inReplyToMessage
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
    handleSaveDraft,
    applyRecipientSelection,
    loadRecipientOptions,
    markComposeDirty,
    jumpToMessage
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
        <div className={`${composeStyles.composeBody} ${styles.body}`}>{ui.composeMessageField}</div>
        <ComposeActions
          composeDraftId={composeDraftId}
          composeOpen={composeOpen}
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
