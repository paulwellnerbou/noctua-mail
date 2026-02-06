import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { IconButton } from "@radix-ui/themes";
import styles from "./ThreadMessageCard.module.css";

type MessageRecipientMetaFieldProps = {
  label: "From" | "To" | "Cc" | "Bcc";
  value?: string;
  copyValue?: string;
  variant?: "line" | "segment";
  className?: string;
  hideWhenEmpty?: boolean;
  expandable?: boolean;
  expandThreshold?: number;
};

export default function MessageRecipientMetaField({
  label,
  value,
  copyValue,
  variant = "line",
  className,
  hideWhenEmpty = false,
  expandable = false,
  expandThreshold = 120
}: MessageRecipientMetaFieldProps) {
  const [expanded, setExpanded] = useState(false);
  const [copyOk, setCopyOk] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  const text = value ?? "";
  const normalizedCopyValue = copyValue?.trim() ?? "";

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    []
  );

  if (hideWhenEmpty && !text.trim()) return null;

  const canToggle = expandable && text.length > expandThreshold;
  const hasCopy = normalizedCopyValue.length > 0;
  const copyActive = copyOk;

  const handleCopy = async () => {
    if (!hasCopy) return;
    try {
      await navigator.clipboard.writeText(normalizedCopyValue);
      setCopyOk(true);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopyOk(false);
        resetTimerRef.current = null;
      }, 1200);
    } catch {
      // ignore
    }
  };

  const valueNode = (
    <span
      className={[
        styles.metaValue,
        variant === "line" ? styles.toValue : "",
        expanded ? styles.toValueExpanded : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {text}
      {hasCopy && (
        <IconButton
          size="1"
          variant="ghost"
          color="gray"
          className={`${styles.toCopy} ${copyActive ? styles.copyOk : ""}`}
          title={copyActive ? "Copied" : "Copy emails"}
          aria-label={copyActive ? "Copied" : "Copy emails"}
          onClick={handleCopy}
        >
          <span className={styles.copyIconSwap} aria-hidden>
            <Copy
              size={12}
              className={`${styles.copyGlyph} ${
                copyActive ? styles.copyGlyphExit : styles.copyGlyphEnter
              }`}
            />
            <Check
              size={12}
              className={`${styles.copyGlyph} ${
                copyActive ? styles.copyGlyphEnter : styles.copyGlyphExit
              }`}
            />
          </span>
        </IconButton>
      )}
    </span>
  );

  if (variant === "segment") {
    return (
      <div className={[styles.metaSegment, className].filter(Boolean).join(" ")}>
        <span className={styles.metaLabel}>{label}:</span>
        {valueNode}
      </div>
    );
  }

  return (
    <div className={[styles.metaLine, styles.metaLineTo, className].filter(Boolean).join(" ")}>
      <span className={styles.metaLabel}>{label}:</span>
      <div className={styles.toWrapper}>
        {valueNode}
        {canToggle && (
          <button className={styles.moreButton} type="button" onClick={() => setExpanded((prev) => !prev)}>
            {expanded ? "less..." : "more..."}
          </button>
        )}
      </div>
    </div>
  );
}
