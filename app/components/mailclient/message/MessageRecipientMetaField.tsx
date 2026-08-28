import { Fragment, useEffect, useRef, useState } from "react";
import { Check, Copy, List } from "lucide-react";
import { IconButton } from "@radix-ui/themes";
import styles from "./ThreadMessageCard.module.css";
import EmailAddressMenu, { type EmailAddressMenuAction } from "./EmailAddressMenu";
import { parseAddressList } from "../utils/parseAddressList";

type MessageRecipientMetaFieldProps = {
  label: "From" | "To" | "Cc" | "Bcc";
  value?: string;
  copyValue?: string;
  aliasName?: string | null;
  showAliasAction?: boolean;
  onAliasAction?: () => void;
  variant?: "line" | "segment";
  className?: string;
  hideWhenEmpty?: boolean;
  expandable?: boolean;
  expandThreshold?: number;
  onSearchByAddress?: (action: EmailAddressMenuAction, email: string) => void;
  onComposeTo?: (email: string) => void;
};

export default function MessageRecipientMetaField({
  label,
  value,
  copyValue,
  aliasName = null,
  showAliasAction = false,
  onAliasAction,
  variant = "line",
  className,
  hideWhenEmpty = false,
  expandable = false,
  expandThreshold = 120,
  onSearchByAddress,
  onComposeTo
}: MessageRecipientMetaFieldProps) {
  const [expanded, setExpanded] = useState(false);
  const [copyOk, setCopyOk] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  const valueRef = useRef<HTMLSpanElement | null>(null);
  const text = value ?? "";
  const normalizedCopyValue = copyValue?.trim() ?? "";
  const shouldMeasureOverflow = expandable && text.length > expandThreshold;

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    []
  );

  const hasCopy = normalizedCopyValue.length > 0;
  const canToggle = shouldMeasureOverflow && (expanded || hasOverflow);
  const copyActive = copyOk;

  useEffect(() => {
    if (!shouldMeasureOverflow) return;

    const node = valueRef.current;
    if (!node) return;

    const measureOverflow = () => {
      // Use hidden content deltas directly; line-height math is prone to rounding false positives.
      const hiddenHeight = node.scrollHeight - node.clientHeight;
      const hiddenWidth = node.scrollWidth - node.clientWidth;
      setHasOverflow(hiddenHeight > 2 || hiddenWidth > 2);
    };

    const frameId = window.requestAnimationFrame(measureOverflow);

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measureOverflow);
      return () => {
        window.cancelAnimationFrame(frameId);
        window.removeEventListener("resize", measureOverflow);
      };
    }

    const observer = new ResizeObserver(measureOverflow);
    observer.observe(node);
    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [aliasName, hasCopy, shouldMeasureOverflow, showAliasAction, text]);

  if (hideWhenEmpty && !text.trim()) return null;

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

  const parsed = onSearchByAddress ? parseAddressList(text) : [];
  const renderAddresses = parsed.length > 0;

  const valueNode = (
    <span
      ref={valueRef}
      className={[
        styles.metaValue,
        variant === "line" ? styles.toValue : "",
        expanded ? styles.toValueExpanded : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {aliasName && <span className={styles.aliasPrefix}>{`${aliasName}: `}</span>}
      {renderAddresses && onSearchByAddress
        ? parsed.map((addr, idx) => (
            <Fragment key={`${addr.raw}-${idx}`}>
              {idx > 0 && <span className={styles.addressSeparator}>, </span>}
              {addr.email ? (
                <EmailAddressMenu
                  displayName={addr.displayName}
                  email={addr.email}
                  onSearchByAddress={onSearchByAddress}
                  onComposeTo={onComposeTo}
                />
              ) : (
                <span title={addr.raw}>{addr.raw}</span>
              )}
            </Fragment>
          ))
        : text}
      {hasCopy && (
        <IconButton
          size="1"
          variant="ghost"
          color="gray"
          className={`${styles.toCopy} ${copyActive ? styles.copyOk : ""}`}
          title={copyActive ? "Copied" : "Copy addresses"}
          aria-label={copyActive ? "Copied" : "Copy addresses"}
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
      {showAliasAction && (
        <IconButton
          size="1"
          variant="ghost"
          color="gray"
          className={styles.toCopy}
          title={aliasName ? "Manage recipient alias" : "Create recipient alias"}
          aria-label={aliasName ? "Manage recipient alias" : "Create recipient alias"}
          onClick={onAliasAction}
        >
          <List size={12} />
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
