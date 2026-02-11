import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { IconButton } from "@radix-ui/themes";
import styles from "./RawTextPanel.module.css";

type RawTextField = {
  label: string;
  value: string;
};

type RawTextPanelProps = {
  text: string;
  copyText?: string;
  copyLabel: string;
  emptyText?: string;
  fields?: RawTextField[];
  className?: string;
  preClassName?: string;
};

function joinClassNames(...values: Array<string | undefined | null | false>) {
  return values.filter(Boolean).join(" ");
}

export default function RawTextPanel({
  text,
  copyText,
  copyLabel,
  emptyText = "",
  fields = [],
  className,
  preClassName
}: RawTextPanelProps) {
  const [copyOk, setCopyOk] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const hasCopyText = (copyText ?? "").trim().length > 0;
  const displayText = text || emptyText;

  return (
    <div className={joinClassNames(styles.block, className)}>
      {fields.length > 0 ? (
        <div className={styles.fields}>
          {fields.map((field) => (
            <div key={`${field.label}:${field.value}`} className={styles.fieldRow}>
              <span className={styles.fieldLabel}>{field.label}</span>
              <span className={styles.fieldValue}>{field.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      <pre className={joinClassNames(styles.view, preClassName)}>{displayText}</pre>
      <IconButton
        size="1"
        variant="surface"
        className={joinClassNames(styles.copyButton, copyOk && styles.copyOk)}
        onClick={async () => {
          if (!hasCopyText) return;
          try {
            await navigator.clipboard.writeText(copyText ?? "");
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
        }}
        aria-label={copyLabel}
        title={copyLabel}
        disabled={!hasCopyText}
      >
        {copyOk ? <Check size={14} /> : <Copy size={14} />}
      </IconButton>
    </div>
  );
}
