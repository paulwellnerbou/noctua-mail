import { Edit3, Pin } from "lucide-react";
import styles from "./MessageListCommon.module.css";

type MessageSelectIndicatorsProps = {
  isPinned: boolean;
  isDraft: boolean;
  onPinnedClick?: () => void;
};

export default function MessageSelectIndicators({
  isPinned,
  isDraft,
  onPinnedClick
}: MessageSelectIndicatorsProps) {
  if (!isPinned && !isDraft) return null;
  return (
    <span className={styles.selectIcons}>
      {isPinned && (
        onPinnedClick ? (
          <button
            type="button"
            className={`${styles.selectIcon} ${styles.selectIconPinned} ${styles.selectIconButton}`}
            title="Unpin message"
            aria-label="Unpin message"
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onPinnedClick();
            }}
          >
            <Pin size={12} />
          </button>
        ) : (
          <span className={`${styles.selectIcon} ${styles.selectIconPinned}`} title="Pinned">
            <Pin size={12} />
          </span>
        )
      )}
      {isDraft && (
        <span className={`${styles.selectIcon} ${styles.selectIconDraft}`} title="Draft">
          <Edit3 size={12} />
        </span>
      )}
    </span>
  );
}
