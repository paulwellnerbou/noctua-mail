import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { IconButton } from "@radix-ui/themes";
import styles from "./SourcePanel.module.css";

type SourcePanelProps = {
  messageId: string;
  fetchSource: (id: string) => Promise<string | null>;
  scrubSource: (value?: string) => string | undefined;
};

export default function SourcePanel({ messageId, fetchSource, scrubSource }: SourcePanelProps) {
  const [sourceState, setSourceState] = useState<{
    messageId: string;
    source: string;
    status: "loaded" | "error";
  } | null>(null);
  const [copyOk, setCopyOk] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchSource(messageId).then((data) => {
      if (!active) return;
      if (data === null) {
        console.warn("[noctua] source fetch returned null", { messageId });
        setSourceState({ messageId, source: "", status: "error" });
        return;
      }
      setSourceState({ messageId, source: data || "", status: "loaded" });
    });
    return () => {
      active = false;
      console.info("[noctua] source panel cleanup", { messageId });
    };
  }, [messageId, fetchSource]);
  const status =
    sourceState && sourceState.messageId === messageId ? sourceState.status : "loading";
  const source = sourceState && sourceState.messageId === messageId ? sourceState.source : "";

  return (
    <div className={styles.sourceBlock}>
      <pre className={styles.sourceView}>
        {status === "loading"
          ? "Loading source…"
          : status === "error"
            ? "Failed to load source."
            : scrubSource(source)}
      </pre>
      <IconButton
        size="1"
        variant="surface"
        className={`${styles.copyButton} ${copyOk ? styles.copyOk : ""}`}
        onClick={async () => {
          if (!source) return;
          try {
            await navigator.clipboard.writeText(source);
            setCopyOk(true);
            setTimeout(() => setCopyOk(false), 1200);
          } catch {
            // ignore
          }
        }}
        aria-label="Copy source"
        title="Copy source"
      >
        {copyOk ? <Check size={14} /> : <Copy size={14} />}
      </IconButton>
    </div>
  );
}
