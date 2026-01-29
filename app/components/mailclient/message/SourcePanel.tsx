import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

type SourcePanelProps = {
  messageId: string;
  fetchSource: (id: string) => Promise<string | null>;
  scrubSource: (value?: string) => string | undefined;
};

export default function SourcePanel({ messageId, fetchSource, scrubSource }: SourcePanelProps) {
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [copyOk, setCopyOk] = useState(false);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    void fetchSource(messageId).then((data) => {
      if (!active) return;
      if (data === null) {
        console.warn("[noctua] source fetch returned null", { messageId });
        setStatus("error");
        return;
      }
      setSource(data || "");
      setStatus("loaded");
    });
    return () => {
      active = false;
      console.info("[noctua] source panel cleanup", { messageId });
    };
  }, [messageId, fetchSource]);

  return (
    <div className="source-block">
      <pre className="source-view">
        {status === "loading"
          ? "Loading source…"
          : status === "error"
            ? "Failed to load source."
            : scrubSource(source)}
      </pre>
      <button
        className={`json-copy ${copyOk ? "ok" : ""}`}
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
      </button>
    </div>
  );
}
