import type React from "react";
import { ArrowUpRight } from "lucide-react";
import { Badge, Button, Card, IconButton, Text } from "@radix-ui/themes";
import { badgeColors } from "@/lib/ui/badgeColors";
import ComposeFields from "./ComposeFields";
import threadStyles from "../message/ThreadMessageCard.module.css";
import styles from "./ComposeInlineCard.module.css";

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
    composeFieldsReset: number;
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
      setter: React.Dispatch<React.SetStateAction<string>>,
      focusAfter?: "to" | "cc" | "bcc" | null
    ) => string;
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
    composeFieldsReset,
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
    <Card
      asChild
      size="2"
      variant="surface"
      className={`${threadStyles.card} ${styles.card} ${
        discardingDraft ? styles.disabled : ""
      }${composeDragActive ? " compose-drop-active" : ""}`}
    >
      <article
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
        <div className={`compose-body ${styles.body}`}>{ui.composeMessageField}</div>
      <div className="compose-footer">
        <div className="compose-draft-meta">
          {composeDraftId && (
            <Text size="1" color="gray" className="compose-draft">
              Draft: {composeDraftId}
            </Text>
          )}
          {composeOpen && (
            <Text
              size="1"
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
            </Text>
          )}
        </div>
        <div className="compose-actions">
          {composeDraftId && (
            <Button
              size="2"
              variant="soft"
              color="red"
              onClick={handleDiscardDraft}
              disabled={discardingDraft}
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
            {composeMode === "edit" ? "Cancel editing" : "Cancel"}
          </Button>
          <Button size="2" onClick={handleSendMail} disabled={sendingMail}>
            {sendingMail ? "Sending..." : "Send"}
          </Button>
        </div>
      </div>
      </article>
    </Card>
  );
}
