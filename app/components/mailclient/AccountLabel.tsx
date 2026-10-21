import styles from "./AccountLabel.module.css";

type AccountLabelProps = {
  name?: string | null;
  email?: string | null;
  emphasized?: boolean;
  className?: string;
};

// Accounts can share a display name, so the email line is what tells them apart.
export default function AccountLabel({
  name,
  email,
  emphasized = false,
  className = ""
}: AccountLabelProps) {
  const trimmedName = name?.trim() ?? "";
  const trimmedEmail = email?.trim() ?? "";
  const primary = trimmedName || trimmedEmail;
  const secondary = trimmedName && trimmedEmail ? trimmedEmail : null;
  const rootClassName = [styles.root, emphasized ? styles.emphasized : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={rootClassName}>
      <span className={styles.name}>{primary}</span>
      {secondary ? <span className={styles.email}>{secondary}</span> : null}
    </span>
  );
}
