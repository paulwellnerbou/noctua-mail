import { useEffect, useRef, useState } from "react";
import RawTextPanel from "./RawTextPanel";

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
  const fetchSourceRef = useRef(fetchSource);

  useEffect(() => {
    fetchSourceRef.current = fetchSource;
  }, [fetchSource]);

  useEffect(() => {
    let active = true;
    void fetchSourceRef.current(messageId).then((data) => {
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
  }, [messageId]);
  
  const status =
    sourceState && sourceState.messageId === messageId ? sourceState.status : "loading";
  const source = sourceState && sourceState.messageId === messageId ? sourceState.source : "";
  const text =
    status === "loading"
      ? "Loading source…"
      : status === "error"
        ? "Failed to load source."
        : scrubSource(source) ?? "";

  return (
    <RawTextPanel
      text={text}
      copyText={status === "loaded" ? source : ""}
      copyLabel="Copy source"
      constrainHeight={false}
    />
  );
}
