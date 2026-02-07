import { Edit3 } from "lucide-react";
import styles from "./MessageListCommon.module.css";

type MessageSelectIndicatorsProps = {
  isFlagged: boolean;
  isDraft: boolean;
  onFlaggedClick?: () => void;
};

export default function MessageSelectIndicators({
  isFlagged,
  isDraft,
  onFlaggedClick
}: MessageSelectIndicatorsProps) {
  if (!isDraft) return null;
  return (
    <span className={styles.selectIcons}>
      {isDraft && (
        <span className={`${styles.selectIcon} ${styles.selectIconDraft}`} title="Draft">
          <Edit3 size={12} />
        </span>
      )}
    </span>
  );
}
