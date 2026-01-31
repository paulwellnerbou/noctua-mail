import styles from "./MessageListCommon.module.css";

type UnreadDotProps = {
  seen: boolean;
  disabled?: boolean;
  onToggle: () => void;
};

export default function UnreadDot({ seen, disabled, onToggle }: UnreadDotProps) {
  return (
    <button
      type="button"
      className={`${styles.unreadDot} ${seen ? styles.unreadDotRead : ""} ${
        disabled ? styles.unreadDotDisabled : ""
      }`}
      title={seen ? "Mark as unread" : "Mark as read"}
      aria-label={seen ? "Mark as unread" : "Mark as read"}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    />
  );
}
