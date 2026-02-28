import styles from "./InReplyToReferenceRow.module.css";

type InReplyToReferenceRowProps = {
  variant: "message" | "compose";
  value: string;
  onClick?: () => void;
  label?: string;
};

export default function InReplyToReferenceRow({
  variant,
  value,
  onClick,
  label = "In Reply To:"
}: InReplyToReferenceRowProps) {
  return (
    <div className={variant === "compose" ? styles.composeRow : styles.messageRow}>
      <span className={styles.label}>{label}</span>
      <div className={styles.content}>
        {onClick ? (
          <button type="button" className={styles.link} onClick={onClick}>
            {value}
          </button>
        ) : (
          <span className={styles.value}>{value}</span>
        )}
      </div>
    </div>
  );
}

export type { InReplyToReferenceRowProps };
