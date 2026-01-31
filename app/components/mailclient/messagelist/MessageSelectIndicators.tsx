import { Edit3, Pin } from "lucide-react";
import styles from "./MessageListCommon.module.css";

type MessageSelectIndicatorsProps = {
  isPinned: boolean;
  isDraft: boolean;
};

export default function MessageSelectIndicators({
  isPinned,
  isDraft
}: MessageSelectIndicatorsProps) {
  if (!isPinned && !isDraft) return null;
  return (
    <span className={styles.selectIcons} aria-hidden="true">
      {isPinned && (
        <span className={`${styles.selectIcon} ${styles.selectIconPinned}`} title="Pinned">
          <Pin size={12} />
        </span>
      )}
      {isDraft && (
        <span className={`${styles.selectIcon} ${styles.selectIconDraft}`} title="Draft">
          <Edit3 size={12} />
        </span>
      )}
    </span>
  );
}
