import { Button, Text } from "@radix-ui/themes";
import styles from "./Compose.module.css";

type ComposeActionsProps = {
  composeDraftId: string | null;
  composeOpen: boolean;
  draftSaving: boolean;
  draftSaveError: string | null;
  draftSavedAt: number | null;
  sendingMail: boolean;
  discardingDraft: boolean;
  handleDiscardDraft: () => void;
  handleSaveDraft: () => void;
  handleCancel: () => void;
  handleSendMail: () => void;
  formatRelativeTime: (timestamp: number | null) => string;
};

export default function ComposeActions({
  composeDraftId,
  composeOpen,
  draftSaving,
  draftSaveError,
  draftSavedAt,
  sendingMail,
  discardingDraft,
  handleDiscardDraft,
  handleSaveDraft,
  handleCancel,
  handleSendMail,
  formatRelativeTime
}: ComposeActionsProps) {
  return (
    <div className={styles.composeFooter}>
      <div className={styles.composeDraftMeta}>
        {composeOpen && (
          <Text
            size="1"
            title={composeDraftId ? `Draft: ${composeDraftId}` : undefined}
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
          <>
            <Button
              size="2"
              variant="soft"
              color="red"
              onClick={handleDiscardDraft}
              disabled={discardingDraft || draftSaving}
            >
              Discard Draft
            </Button>
            <Button
              size="2"
              variant="soft"
              color="blue"
              onClick={handleSaveDraft}
              disabled={draftSaving}
            >
              {draftSaving ? "Saving..." : "Save draft"}
            </Button>
          </>
        )}
        <Button size="2" variant="soft" color="gray" onClick={handleCancel}>
          Cancel
        </Button>
        <Button size="2" onClick={handleSendMail} disabled={sendingMail}>
          {sendingMail ? "Sending..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
