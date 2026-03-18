import { useMemo, useState, type CSSProperties } from "react";
import { buildAccountSenderIconPath } from "@/lib/accountApiPaths";
import { getSenderIconColors, getSenderIdentity } from "@/lib/senderIdentity";
import styles from "./SenderIcon.module.css";

type SenderIconProps = {
  accountId: string;
  from?: string | null;
  fromEmail?: string | null;
  enabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  title?: string;
};

export default function SenderIcon({
  accountId,
  from,
  fromEmail,
  enabled = true,
  size = "sm",
  className = "",
  title
}: SenderIconProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const identity = useMemo(
    () => getSenderIdentity({ from, fromEmail }),
    [from, fromEmail]
  );
  const src = useMemo(() => {
    const search = new URLSearchParams({
      from: from ?? ""
    });
    if (fromEmail) search.set("fromEmail", fromEmail);
    return buildAccountSenderIconPath(accountId, search);
  }, [accountId, from, fromEmail]);

  if (!enabled || !accountId) return null;

  const colors = getSenderIconColors(identity.paletteIndex);

  return (
    <span
      className={[
        styles.icon,
        size === "md" ? styles.iconMd : styles.iconSm,
        className
      ]
        .filter(Boolean)
        .join(" ")}
      title={title}
      aria-hidden="true"
      style={
        {
          "--sender-icon-bg": colors.background,
          "--sender-icon-fg": colors.foreground
        } as CSSProperties
      }
    >
      <span className={styles.placeholder}>{identity.initials}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={`${styles.image} ${loadedSrc === src ? styles.imageLoaded : ""}`}
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoadedSrc(src)}
        onError={() => setLoadedSrc(null)}
      />
    </span>
  );
}
