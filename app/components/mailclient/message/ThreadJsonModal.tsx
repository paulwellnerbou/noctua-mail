import type React from "react";
import { Check, Copy, X } from "lucide-react";

type ThreadJsonModalProps = {
  open: boolean;
  omitBody: boolean;
  jsonPayload: unknown;
  copyOk: boolean;
  onClose: () => void;
  onToggleOmitBody: () => void;
  onCopyOk: (value: boolean) => void;
};

export default function ThreadJsonModal({
  open,
  omitBody,
  jsonPayload,
  copyOk,
  onClose,
  onToggleOmitBody,
  onCopyOk
}: ThreadJsonModalProps) {
  if (!open) return null;

  const payload = JSON.stringify(jsonPayload, null, 2);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <button
          className="icon-button modal-close"
          type="button"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <X size={14} />
        </button>
        <h3>Thread JSON</h3>
        <p>Messages currently visible in the message view pane (thread).</p>
        <div className="json-toolbar">
          <button
            className={`toggle-button ${omitBody ? "" : "on"}`}
            role="switch"
            aria-checked={!omitBody}
            onClick={onToggleOmitBody}
          >
            Include body
          </button>
        </div>
        <div className="json-block">
          <pre className="json-view">{payload}</pre>
          <button
            className={`json-copy ${copyOk ? "ok" : ""}`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(payload);
                onCopyOk(true);
                setTimeout(() => onCopyOk(false), 1200);
              } catch {
                // ignore
              }
            }}
            aria-label="Copy JSON"
            title="Copy JSON"
          >
            {copyOk ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}
