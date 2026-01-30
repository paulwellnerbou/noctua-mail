type UnreadDotProps = {
  seen: boolean;
  disabled?: boolean;
  onToggle: () => void;
};

export default function UnreadDot({ seen, disabled, onToggle }: UnreadDotProps) {
  return (
    <button
      type="button"
      className={`unread-dot ${seen ? "read" : "unread"}`}
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
